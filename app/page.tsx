"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES, DEPOSITS, SCENARIO_4, kzt, simulateDeposit, monthsToGoal,
  type AnalyzeInput, type AnalyzeResult, type Category,
} from "@/lib/engine";

type Res = AnalyzeResult & { latencyMs: number };
const fmt = (n: number) => (n ? new Intl.NumberFormat("en-US").format(n) : "");
const EMPTY: AnalyzeInput = {
  income: 0, savings: 0, price: 0, itemName: "", trimPct: 0.15,
  expenses: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
};

function Money({ label, value, onChange, bad }: { label: string; value: number; onChange: (n: number) => void; bad?: string }) {
  return (
    <label className="f">
      <span>{label}</span>
      <div className={"inp" + (bad ? " bad" : "")}>
        <input inputMode="numeric" value={fmt(value)} placeholder="0" aria-invalid={!!bad}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
        <i>₸</i>
      </div>
      {bad && <div className="err">{bad}</div>}
    </label>
  );
}

function Months({ m }: { m: number | null }) {
  if (m === null) return <>—</>;
  if (m === 0) return <>now</>;
  return <>{m.toFixed(1)} mo</>;
}
const addMonths = (m: number) => {
  const d = new Date(); d.setDate(d.getDate() + Math.round(m * 30.44));
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

export default function Home() {
  const [inp, setInp] = useState<AnalyzeInput>(EMPTY);
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"verdict" | "deposits">("verdict");
  const [touched, setTouched] = useState(false);

  // deposit tab state
  const [initial, setInitial] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [term, setTerm] = useState(12);
  const [goal, setGoal] = useState(0);
  const depTouched = useRef({ initial: false, monthly: false, goal: false });

  const errors = {
    income: touched && inp.income <= 0 ? "Enter your monthly net income" : "",
    price: touched && inp.price <= 0 ? "Enter the purchase price" : "",
  };
  const valid = inp.income > 0 && inp.price > 0;
  const setExp = (c: Category, n: number) => { setTouched(true); setInp((p) => ({ ...p, expenses: { ...p.expenses, [c]: n } })); };
  const set = <K extends keyof AnalyzeInput>(k: K, v: AnalyzeInput[K]) => { setTouched(true); setInp((p) => ({ ...p, [k]: v })); };

  // call the API (debounced); the route runs the same engine the FastAPI service would
  useEffect(() => {
    if (!valid) { setRes(null); return; }
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inp), signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Request failed");
        setRes(j); setApiErr(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setApiErr((e as Error).message);
      } finally { setBusy(false); }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [inp, valid]);

  // sensible defaults for the deposit tab, until the user edits them
  useEffect(() => {
    if (!res) return;
    const d = depTouched.current;
    if (!d.initial) setInitial(inp.savings);
    if (!d.monthly) setMonthly(res.plan?.monthlySave ?? Math.max(0, res.freeCash));
    if (!d.goal) setGoal(Math.round(res.guardrail + inp.price));
  }, [res, inp.savings, inp.price]);

  const loadDemo = () => {
    depTouched.current = { initial: false, monthly: false, goal: false };
    setTouched(false); setInp(SCENARIO_4); setTab("verdict");
  };
  const reset = () => { depTouched.current = { initial: false, monthly: false, goal: false }; setTouched(false); setInp(EMPTY); setRes(null); };

  const dep = useMemo(() => DEPOSITS.map((p) => simulateDeposit(p, initial, monthly, term)), [initial, monthly, term]);
  const best = useMemo(() => dep.filter((d) => d.termOk).sort((a, b) => b.finalBalance - a.finalBalance)[0] ?? null, [dep]);

  return (
    <>
      <div className="banner" role="note">
        <span className="ic">⚠</span>
        <span><b>Educational decision-support only.</b> Financial Assistant provides analytical simulations and comparisons. It does not access bank accounts, execute transactions, or give licensed financial, investment or credit advice. All deposit products are synthetic reference examples.</span>
      </div>

      <div className="wrap">
        <header className="top">
          <div className="eyebrow">Astana IT University · BDA-2402 · Prototype v1.0</div>
          <h1>Financial Assistant</h1>
          <p className="sub">Check whether a planned purchase is safe for your budget, see why, and compare Kazakhstan savings deposits — in under two minutes.</p>
          <button className="demo-btn" onClick={loadDemo}>▶ Load demo: student, 450,000 ₸ laptop</button>{" "}
          {valid && <button className="demo-btn ghost" onClick={reset}>Clear</button>}
        </header>

        <div className="grid">
          {/* ---------- INPUT ---------- */}
          <aside className="card stick" aria-label="Budget input">
            <h2>1 · Your budget</h2>
            <p className="hint">Monthly amounts in tenge. Nothing leaves this prototype.</p>
            <Money label="Monthly net income" value={inp.income} onChange={(n) => set("income", n)} bad={errors.income} />
            <div className="sect"><span>Monthly spending</span><b>{kzt(CATEGORIES.reduce((s, c) => s + inp.expenses[c], 0))}</b></div>
            <div className="two">
              {CATEGORIES.map((c) => <Money key={c} label={c} value={inp.expenses[c]} onChange={(n) => setExp(c, n)} />)}
            </div>
            <div className="sect"><span>Savings & purchase</span></div>
            <Money label="Current liquid savings" value={inp.savings} onChange={(n) => set("savings", n)} />
            <label className="f"><span>Planned purchase</span>
              <div className="inp"><input value={inp.itemName} placeholder="e.g. Engineering laptop" maxLength={60} onChange={(e) => set("itemName", e.target.value)} /></div>
            </label>
            <Money label="Purchase price" value={inp.price} onChange={(n) => set("price", n)} bad={errors.price} />
          </aside>

          {/* ---------- RESULTS ---------- */}
          <main>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === "verdict"} onClick={() => setTab("verdict")}>2 · Purchase verdict</button>
              <button role="tab" aria-selected={tab === "deposits"} onClick={() => setTab("deposits")}>3 · Deposit comparator</button>
            </div>

            {!res && (
              <div className="card"><h2>Waiting for your numbers</h2>
                <p className="hint" style={{ margin: 0 }}>{apiErr ? apiErr : "Enter income and a purchase price, or load the demo scenario to see a full result."}</p></div>
            )}

            {res && tab === "verdict" && <Verdict res={res} inp={inp} busy={busy} setTrim={(v) => set("trimPct", v)} />}
            {res && tab === "deposits" && (
              <Deposits {...{ res, inp, dep, best, initial, monthly, term, goal, busy }}
                setInitial={(n) => { depTouched.current.initial = true; setInitial(n); }}
                setMonthly={(n) => { depTouched.current.monthly = true; setMonthly(n); }}
                setGoal={(n) => { depTouched.current.goal = true; setGoal(n); }}
                setTerm={setTerm} />
            )}
          </main>
        </div>
        <p className="foot">Prototype built from the Part 2 project report. Verdict logic: deterministic disposable-income guardrails followed by a weighted factor model (stand-in for the Random Forest in the FastAPI backend). Figures are illustrative.</p>
      </div>
    </>
  );
}

function Verdict({ res, inp, busy, setTrim }: { res: Res; inp: AnalyzeInput; busy: boolean; setTrim: (v: number) => void }) {
  const need = res.guardrail;
  const scale = Math.max(inp.savings, need * 1.2, 1);
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / scale) * 100))}%`;
  const fillColor = res.postSavings >= need ? "var(--green)" : res.postSavings > 0 ? "#f59e0b" : "var(--red)";
  const maxShare = Math.max(...res.breakdown.map((b) => Math.max(b.share, b.peerShare)), 0.01);
  const ent = inp.expenses.Entertainment;
  return (
    <div className={busy ? "loading" : ""}>
      <p className="meta">API latency {res.latencyMs} ms</p>
      <div className={`verdict ${res.verdict}`} role="status">
        <div className="light" aria-hidden><span /><span /><span /></div>
        <div className="v-main">
          <div className="badge">{res.verdict === "safe" ? "Green · Safe" : res.verdict === "caution" ? "Amber · Caution" : "Red · High risk"}</div>
          <h3>{res.verdictLabel}</h3>
        </div>
        <div className="score"><b>{res.riskScore}</b>/100<small>risk score</small></div>
      </div>

      <div className="stats">
        <div className="stat"><small>Total spending</small><b>{kzt(res.totalExpenses)}</b></div>
        <div className={"stat " + (res.freeCash >= 0 ? "pos" : "neg")}><small>Free cash flow / mo</small><b>{res.freeCash >= 0 ? "+" : "−"}{kzt(Math.abs(res.freeCash))}</b></div>
        <div className="stat"><small>Savings after purchase</small><b>{kzt(res.postSavings)}</b></div>
        <div className={"stat " + (res.bufferMonthsAfter < 1 ? "neg" : "pos")}><small>Buffer after purchase</small><b>{res.bufferMonthsAfter.toFixed(2)} mo</b></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Post-purchase liquidity buffer</h2>
        <p className="hint">Bar shows savings after paying cash; the line is the 1-month safety guardrail ({kzt(need)}).</p>
        <div className="buf">
          <div className="track"><div className="fill" style={{ width: pct(Math.max(0, res.postSavings)), background: fillColor }} /><div className="mark" style={{ left: pct(need) }} /></div>
          <div className="lbl"><span>0</span><span>Now {kzt(inp.savings)}</span></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Top 3 factors behind the verdict</h2>
        <p className="hint">Plain-language drivers, with model weights.</p>
        {res.factors.map((f, i) => (
          <div className="factor" key={i}>
            <div className="n">{i + 1}</div>
            <div><h4>{f.title} <span className="w">· {f.weight}% weight</span></h4><p>{f.text}</p></div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="rec"><span className="eyebrow">Suggested action</span>{res.recommendation}</div>
        <div className="sect" style={{ marginTop: 16 }}><span>What-if: trim Entertainment</span></div>
        <div className="whatif">
          <input type="range" min={0} max={0.5} step={0.05} value={inp.trimPct} onChange={(e) => setTrim(Number(e.target.value))} aria-label="Entertainment trim percent" />
          <output>{Math.round(inp.trimPct * 100)}%</output>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>= {kzt(Math.round(ent * inp.trimPct))}/mo extra saved</span>
        </div>
      </div>

      <div className="card">
        <h2>Spending vs. peer median</h2>
        <p className="hint">Share of your income by category. Orange = more than 15% above peers.</p>
        <div className="bars">
          {res.breakdown.map((b) => (
            <div className="row" key={b.category}>
              <span>{b.category}</span>
              <div className="t"><i className={b.share > b.peerShare * 1.15 && b.amount > 5000 ? "over" : ""} style={{ width: `${(b.share / maxShare) * 100}%` }} /><u style={{ left: `${(b.peerShare / maxShare) * 100}%` }} /></div>
              <span className="v">{kzt(b.amount)}</span>
            </div>
          ))}
        </div>
        <div className="legend"><span>Your share</span><span className="o">Above peers</span><span className="k">Peer median</span></div>
        {res.anomalies.map((a) => (
          <div className="alert" key={a.category}><b>Anomaly:</b> {a.category} is {a.pctAbove}% above the peer median ({kzt(a.peer)}).</div>
        ))}
      </div>
    </div>
  );
}

function Deposits(p: {
  res: Res; inp: AnalyzeInput; dep: ReturnType<typeof simulateDeposit>[]; best: ReturnType<typeof simulateDeposit> | null;
  initial: number; monthly: number; term: number; goal: number; busy: boolean;
  setInitial: (n: number) => void; setMonthly: (n: number) => void; setTerm: (n: number) => void; setGoal: (n: number) => void;
}) {
  const { res, inp, dep, best, initial, monthly, term, goal } = p;
  const nominal = best?.product.nominal ?? 0.138;
  const trimAmt = Math.round(inp.expenses.Entertainment * inp.trimPct);
  const base = Math.max(0, res.freeCash);
  const mBase = monthsToGoal(nominal, initial, base, goal);
  const mTrim = monthsToGoal(nominal, initial, base + trimAmt, goal);
  const saved = mBase !== null && mTrim !== null ? mBase - mTrim : null;

  // balance-growth chart for the best product
  const W = 560, H = 180, pad = 8;
  const s = best?.series ?? [];
  const contrib = s.map((_, i) => initial + monthly * i);
  const max = Math.max(...s, 1), min = Math.min(...contrib, 0);
  const x = (i: number) => pad + (i / Math.max(1, s.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const line = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <div className={p.busy ? "loading" : ""}>
      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Deposit plan</h2>
        <p className="hint">Defaults come from your purchase plan. Monthly compounding, top-ups at month end.</p>
        <div className="two">
          <Money label="Initial deposit" value={initial} onChange={p.setInitial} />
          <Money label="Monthly top-up" value={monthly} onChange={p.setMonthly} />
        </div>
        <label className="f"><span>Term: {term} months</span>
          <input type="range" min={3} max={36} step={1} value={term} style={{ width: "100%", accentColor: "var(--teal)" }} onChange={(e) => p.setTerm(Number(e.target.value))} />
        </label>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Kazakhstan deposit comparison</h2>
        <p className="hint">Synthetic reference catalog, sorted by final balance. “Effective rate” is the annual rate after monthly compounding (GESV-style).</p>
        <div className="tw"><table>
          <thead><tr><th>Product</th><th className="r">Nominal</th><th className="r">Effective</th><th className="r">Interest 3 mo</th><th className="r">Interest {term} mo</th><th className="r">Final balance</th></tr></thead>
          <tbody>
            {[...dep].sort((a, b) => b.finalBalance - a.finalBalance).map((d) => (
              <tr key={d.product.id} className={(best?.product.id === d.product.id ? "best " : "") + (d.termOk ? "" : "dim")}>
                <td>{d.product.id}. {d.product.name}{best?.product.id === d.product.id && <span className="pill-best">BEST</span>}<br />
                  <span className="tag">{d.product.access}</span>{" "}{!d.termOk && <span className="tag warn">min {d.product.minTerm} mo</span>}</td>
                <td className="r">{(d.product.nominal * 100).toFixed(1)}%</td>
                <td className="r">{(d.ear * 100).toFixed(1)}%</td>
                <td className="r">{kzt(d.interest3)}</td>
                <td className="r">{kzt(d.interest)}</td>
                <td className="r">{kzt(d.finalBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {best && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Growth with {best.product.name}</h2>
          <p className="hint">Teal: balance. Grey: your own contributions only. Interest earned: <b>{kzt(best.interest)}</b>.</p>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Deposit balance growth chart">
            <path d={line(contrib)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
            <path d={`${line(s)}L${x(s.length - 1)},${H - pad}L${x(0)},${H - pad}Z`} fill="rgba(15,118,110,.12)" />
            <path d={line(s)} fill="none" stroke="#0f766e" strokeWidth="2.5" />
          </svg>
        </div>
      )}

      <div className="card">
        <h2>Goal completion</h2>
        <p className="hint">Time to reach the savings needed for the purchase plus a 1-month buffer, using {best ? best.product.name : "the best deposit"}.</p>
        <Money label="Goal amount" value={goal} onChange={p.setGoal} />
        <div className="goal">
          <div className="stat"><small>Saving {kzt(base)}/mo</small><b><Months m={mBase} /></b>{mBase !== null && mBase > 0 && <small>≈ {addMonths(mBase)}</small>}</div>
          <div className="stat"><small>+ {Math.round(inp.trimPct * 100)}% Entertainment trim ({kzt(base + trimAmt)}/mo)</small><b><Months m={mTrim} /></b>{mTrim !== null && mTrim > 0 && <small>≈ {addMonths(mTrim)}</small>}</div>
        </div>
        {saved !== null && saved > 0.05 && (
          <div className="rec" style={{ marginTop: 12 }}>Trimming Entertainment by {Math.round(inp.trimPct * 100)}% gets you there about <b>{saved >= 1 ? `${saved.toFixed(1)} months` : `${Math.max(1, Math.round(saved * 4.35))} week${Math.round(saved * 4.35) > 1 ? "s" : ""}`}</b> sooner.</div>
        )}
      </div>
    </div>
  );
}
