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

/* ---------------- icons ---------------- */
const P: Record<string, React.ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  spark: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2.5" /><path d="M3 10h18M16 15h2" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /></>,
  trend: <><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></>,
  bank: <path d="M3 10 12 4l9 6M5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 20h18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4m0 3h.01" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.9 1 1 1.6l.1.5h4.8l.1-.5c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3z" /></>,
  calc: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M8.5 7h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /></>,
};
const Icon = ({ n, className = "ico" }: { n: keyof typeof P; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>{P[n]}</svg>
);
const Logo = () => (
  <span className="mark"><svg viewBox="0 0 16 16"><path d="M3.5 12V8M8 12V4M12.5 12V9" /></svg></span>
);

/* ---------------- small components ---------------- */
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

/* ---------------- page ---------------- */
export default function Home() {
  const [inp, setInp] = useState<AnalyzeInput>(EMPTY);
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"verdict" | "deposits">("verdict");
  const [touched, setTouched] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // deposit tab state
  const [initial, setInitial] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [term, setTerm] = useState(12);
  const [goal, setGoal] = useState(0);
  const depTouched = useRef({ initial: false, monthly: false, goal: false });

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

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

  // shareable demo link: /?demo=1 (optionally &tab=deposits)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("demo")) { setInp(SCENARIO_4); if (q.get("tab") === "deposits") setTab("deposits"); }
  }, []);

  const loadDemo = () => {
    depTouched.current = { initial: false, monthly: false, goal: false };
    setTouched(false); setInp(SCENARIO_4); setTab("verdict");
  };
  const reset = () => { depTouched.current = { initial: false, monthly: false, goal: false }; setTouched(false); setInp(EMPTY); setRes(null); };

  const dep = useMemo(() => DEPOSITS.map((p) => simulateDeposit(p, initial, monthly, term)), [initial, monthly, term]);
  const best = useMemo(() => dep.filter((d) => d.termOk).sort((a, b) => b.finalBalance - a.finalBalance)[0] ?? null, [dep]);
  const totalSpend = CATEGORIES.reduce((s, c) => s + inp.expenses[c], 0);

  return (
    <>
      <div className="notice" role="note">
        <div className="wrap">
          <Icon n="info" />
          <span><b>Educational decision-support only.</b><span className="long"> Not licensed financial advice. No bank access, no transactions.</span></span>
          <a href="#disclaimer">Learn more</a>
        </div>
      </div>

      <nav className={"nav" + (scrolled ? " scrolled" : "")} aria-label="Main">
        <div className="wrap">
          <a className="brand" href="#top"><Logo />Financial Assistant <span className="chip">Beta</span></a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#app">Calculator</a>
            <a href="#app" onClick={() => setTab("deposits")}>Deposits</a>
            <a href="#disclaimer">Methodology</a>
          </div>
          <a className="btn btn-primary btn-sm" href="#app">Open calculator</a>
        </div>
      </nav>

      <main id="top">
        {/* ---------- HERO ---------- */}
        <section className="hero">
          <div className="wrap">
            <div>
              <span className="pill"><span className="dot">v1.0</span>Astana IT University · BDA-2402</span>
              <h1>Know if a purchase is safe <span>before</span> you pay.</h1>
              <p className="lede">Financial Assistant stress-tests big purchases against your real budget, explains the verdict in plain language, and finds the Kazakhstan deposit that gets you there faster.</p>
              <div className="cta">
                <a className="btn btn-primary btn-lg" href="#app" onClick={loadDemo}><Icon n="play" />Try the live demo</a>
                <a className="btn btn-secondary btn-lg" href="#how">How it works<Icon n="arrow" /></a>
              </div>
              <ul className="trust">
                <li><Icon n="lock" />No bank connection</li>
                <li><Icon n="shield" />Nothing is stored</li>
                <li><Icon n="spark" />Explainable verdicts</li>
              </ul>
            </div>

            <div className="preview-wrap" aria-hidden>
              <div className="preview">
                <div className="preview-bar"><i /><i /><i /><span>Purchase verdict · Engineering laptop</span></div>
                <div className="preview-body">
                  <div className="pv-verdict">
                    <div className="light"><span /><span /><span /></div>
                    <div><small>Amber · Caution</small><b>Feasible — Conditional</b></div>
                    <div className="pv-score"><b>68</b>risk / 100</div>
                  </div>
                  <div className="pv-grid">
                    <div className="pv-tile"><small>Free cash / mo</small><b>+75,000 ₸</b><em className="up">21%</em></div>
                    <div className="pv-tile"><small>Buffer after</small><b>0.25 mo</b><em className="dn">low</em></div>
                  </div>
                  <div className="pv-chart">
                    <small>Savings with best deposit · 12 mo</small>
                    <svg viewBox="0 0 300 70" preserveAspectRatio="none">
                      <defs><linearGradient id="pvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".28" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
                      <path d="M0,62 C40,58 70,52 110,44 S190,26 230,18 S280,8 300,4 L300,70 L0,70Z" fill="url(#pvg)" />
                      <path d="M0,62 C40,58 70,52 110,44 S190,26 230,18 S280,8 300,4" fill="none" stroke="var(--brand)" strokeWidth="2.5" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="float-card"><Icon n="trend" /><div><b>3 weeks sooner</b><small>with a 15% entertainment trim</small></div></div>
            </div>
          </div>
        </section>

        {/* ---------- METRICS ---------- */}
        <section className="metrics" aria-label="Key facts">
          <div className="wrap">
            <div className="metric"><b>&lt; 2 min</b><span>from numbers to verdict</span></div>
            <div className="metric"><b>3</b><span>weighted factors explained</span></div>
            <div className="metric"><b>{DEPOSITS.length}</b><span>KZ deposit products compared</span></div>
            <div className="metric"><b>0</b><span>bank logins or stored data</span></div>
          </div>
        </section>

        {/* ---------- HOW ---------- */}
        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head">
              <span className="kicker">How it works</span>
              <h2>From a gut feeling to a decision you can explain.</h2>
              <p>Three steps, one screen. Every number on the result page traces back to what you entered.</p>
            </div>
            <div className="features">
              <article className="feature"><span className="step">01</span><div className="fi"><Icon n="wallet" /></div>
                <h3>Enter your budget</h3><p>Monthly income, spending across eight categories, liquid savings and the price of what you want to buy.</p></article>
              <article className="feature"><span className="step">02</span><div className="fi"><Icon n="gauge" /></div>
                <h3>Get an explained verdict</h3><p>A traffic-light risk score, the three factors behind it, and how your spending compares with peers.</p></article>
              <article className="feature"><span className="step">03</span><div className="fi"><Icon n="bank" /></div>
                <h3>Save the smart way</h3><p>Compare Kazakhstan deposits by effective rate and see how small cuts move your goal date.</p></article>
            </div>
          </div>
        </section>

        {/* ---------- APP ---------- */}
        <section className="section app-section" id="app">
          <div className="wrap">
            <div className="section-head row">
              <div>
                <span className="kicker">Calculator</span>
                <h2>Run your numbers.</h2>
                <p>Results update as you type. Use the demo to see a full student scenario.</p>
              </div>
              {valid
                ? <button className="btn btn-secondary" onClick={reset}>Clear inputs</button>
                : <button className="btn btn-primary" onClick={loadDemo}><Icon n="play" />Load demo: student, 450,000 ₸ laptop</button>}
            </div>

            <div className="grid">
              <aside className="card stick" aria-label="Budget input">
                <div className="card-head"><div>
                  <h2><span className="step-no">1</span>Your budget</h2>
                  <p className="hint">Monthly amounts in tenge.</p>
                </div></div>
                <Money label="Monthly net income" value={inp.income} onChange={(n) => set("income", n)} bad={errors.income} />
                <div className="sect"><span>Monthly spending</span><b>{kzt(totalSpend)}</b></div>
                <div className="two">
                  {CATEGORIES.map((c) => <Money key={c} label={c} value={inp.expenses[c]} onChange={(n) => setExp(c, n)} />)}
                </div>
                <div className="sect"><span>Savings & purchase</span></div>
                <Money label="Current liquid savings" value={inp.savings} onChange={(n) => set("savings", n)} />
                <label className="f"><span>What are you buying?</span>
                  <div className="inp"><input value={inp.itemName} placeholder="e.g. Engineering laptop" maxLength={60} onChange={(e) => set("itemName", e.target.value)} /></div>
                </label>
                <Money label="Purchase price" value={inp.price} onChange={(n) => set("price", n)} bad={errors.price} />
              </aside>

              <div>
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={tab === "verdict"} onClick={() => setTab("verdict")}><Icon n="gauge" />Purchase verdict</button>
                  <button role="tab" aria-selected={tab === "deposits"} onClick={() => setTab("deposits")}><Icon n="bank" />Deposit comparator</button>
                </div>

                {!res && (
                  <div className={"card empty" + (apiErr ? " error" : "")}>
                    <div className="ei"><Icon n={apiErr ? "alert" : "calc"} /></div>
                    <h2>{apiErr ? "Something went wrong" : "Waiting for your numbers"}</h2>
                    <p>{apiErr ?? "Enter your income and a purchase price on the left, or load the demo to see a complete result."}</p>
                    {!apiErr && <button className="btn btn-secondary btn-sm" onClick={loadDemo}><Icon n="play" />Load demo</button>}
                  </div>
                )}

                {res && tab === "verdict" && <Verdict res={res} inp={inp} busy={busy} setTrim={(v) => set("trimPct", v)} />}
                {res && tab === "deposits" && (
                  <Deposits {...{ res, inp, dep, best, initial, monthly, term, goal, busy }}
                    setInitial={(n) => { depTouched.current.initial = true; setInitial(n); }}
                    setMonthly={(n) => { depTouched.current.monthly = true; setMonthly(n); }}
                    setGoal={(n) => { depTouched.current.goal = true; setGoal(n); }}
                    setTerm={setTerm} />
                )}
              </div>
            </div>

            <div className="disclaimer" id="disclaimer">
              <div className="di"><Icon n="info" /></div>
              <div>
                <h3>Educational decision-support only</h3>
                <p>Financial Assistant provides analytical simulations and comparisons. It does not access bank accounts, execute transactions, or give licensed financial, investment or credit advice. Verdicts use deterministic disposable-income guardrails followed by a weighted factor model (a stand-in for the Random Forest in the FastAPI backend). All deposit products are synthetic reference examples and figures are illustrative.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="footer-top">
            <div>
              <a className="brand" href="#top"><Logo />Financial Assistant</a>
              <p>Explainable purchase decisions and savings planning for students and young professionals in Kazakhstan.</p>
            </div>
            <div><h4>Product</h4><ul><li><a href="#how">How it works</a></li><li><a href="#app">Calculator</a></li><li><a href="#app" onClick={() => setTab("deposits")}>Deposit comparator</a></li></ul></div>
            <div><h4>Methodology</h4><ul><li>1-month liquidity guardrail</li><li>Weighted factor model</li><li>Monthly-compounded EAR</li></ul></div>
            <div><h4>Project</h4><ul><li>Astana IT University</li><li>Group BDA-2402</li><li>Prototype v1.0</li></ul></div>
          </div>
          <div className="footer-bottom"><span>© 2026 Financial Assistant · Educational prototype</span><span>Not financial advice</span></div>
        </div>
      </footer>
    </>
  );
}

/* ---------------- verdict tab ---------------- */
function Verdict({ res, inp, busy, setTrim }: { res: Res; inp: AnalyzeInput; busy: boolean; setTrim: (v: number) => void }) {
  const need = res.guardrail;
  const scale = Math.max(inp.savings, need * 1.2, 1);
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / scale) * 100))}%`;
  const fillColor = res.postSavings >= need ? "var(--green)" : res.postSavings > 0 ? "#f59e0b" : "var(--red)";
  const maxShare = Math.max(...res.breakdown.map((b) => Math.max(b.share, b.peerShare)), 0.01);
  const ent = inp.expenses.Entertainment;
  return (
    <div className={busy ? "loading" : ""}>
      <p className="meta">Analyzed in {res.latencyMs} ms</p>
      <div className={`verdict ${res.verdict}`} role="status">
        <div className="light" aria-hidden><span /><span /><span /></div>
        <div className="v-main">
          <div className="badge">{res.verdict === "safe" ? "Green · Safe" : res.verdict === "caution" ? "Amber · Caution" : "Red · High risk"}</div>
          <h3>{res.verdictLabel}</h3>
        </div>
        <div className="score"><b>{res.riskScore}</b>/100<small>risk score</small>
          <div className="meter" aria-hidden><i style={{ left: `${res.riskScore}%` }} /></div></div>
      </div>

      <div className="stats">
        <div className="stat"><small>Total spending</small><b>{kzt(res.totalExpenses)}</b></div>
        <div className={"stat " + (res.freeCash >= 0 ? "pos" : "neg")}><small>Free cash flow / mo</small><b>{res.freeCash >= 0 ? "+" : "−"}{kzt(Math.abs(res.freeCash))}</b></div>
        <div className="stat"><small>Savings after purchase</small><b>{kzt(res.postSavings)}</b></div>
        <div className={"stat " + (res.bufferMonthsAfter < 1 ? "neg" : "pos")}><small>Buffer after purchase</small><b>{res.bufferMonthsAfter.toFixed(2)} mo</b></div>
      </div>

      <div className="card">
        <h3 className="t">Post-purchase liquidity buffer</h3>
        <p className="hint">Savings left after paying cash, against the 1-month safety guardrail of {kzt(need)}.</p>
        <div className="buf">
          <div className="track"><div className="fill" style={{ width: pct(Math.max(0, res.postSavings)), background: fillColor }} /><div className="mark" style={{ left: pct(need) }} /></div>
          <div className="lbl"><span>0 ₸</span><span>Savings today {kzt(inp.savings)}</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h3 className="t">Why this verdict</h3><p className="hint">The three biggest drivers, with their model weights.</p></div></div>
        {res.factors.map((f, i) => (
          <div className="factor" key={i}>
            <div className="n">{i + 1}</div>
            <div>
              <h4>{f.title}<span className="w">{f.weight}%</span></h4>
              <p>{f.text}</p>
              <div className="wbar"><i style={{ width: `${f.weight}%` }} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="rec"><Icon n="bulb" /><div><b className="k">Suggested action</b>{res.recommendation}</div></div>
        <div className="sect"><span>What-if: trim Entertainment</span></div>
        <div className="whatif">
          <input type="range" min={0} max={0.5} step={0.05} value={inp.trimPct} onChange={(e) => setTrim(Number(e.target.value))} aria-label="Entertainment trim percent" />
          <output>{Math.round(inp.trimPct * 100)}%</output>
          <span className="note">= {kzt(Math.round(ent * inp.trimPct))}/mo extra saved</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h3 className="t">Spending vs. peer median</h3><p className="hint">Share of income by category. Highlighted when more than 15% above peers.</p></div></div>
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
          <div className="alert" key={a.category}><Icon n="alert" /><span><b>{a.category}</b> is {a.pctAbove}% above the peer median ({kzt(a.peer)}).</span></div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- deposits tab ---------------- */
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
  const W = 560, H = 200, padL = 8, padR = 8, padT = 10, padB = 22;
  const s = best?.series ?? [];
  const contrib = s.map((_, i) => initial + monthly * i);
  const max = Math.max(...s, 1), min = Math.min(...contrib, 0);
  const x = (i: number) => padL + (i / Math.max(1, s.length - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - ((v - min) / (max - min || 1)) * (H - padT - padB);
  const line = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <div className={p.busy ? "loading" : ""}>
      <div className="card">
        <div className="card-head"><div><h3 className="t">Deposit plan</h3><p className="hint">Prefilled from your purchase plan. Monthly compounding, top-ups at month end.</p></div></div>
        <div className="two">
          <Money label="Initial deposit" value={initial} onChange={p.setInitial} />
          <Money label="Monthly top-up" value={monthly} onChange={p.setMonthly} />
        </div>
        <label className="f"><span>Term · <b className="num">{term} months</b></span>
          <input type="range" min={3} max={36} step={1} value={term} onChange={(e) => p.setTerm(Number(e.target.value))} />
        </label>
      </div>

      <div className="card">
        <div className="card-head"><div><h3 className="t">Kazakhstan deposit comparison</h3><p className="hint">Synthetic reference catalog, sorted by final balance. Effective rate is the annual rate after monthly compounding (GESV-style).</p></div></div>
        <div className="tw"><table>
          <thead><tr><th>Product</th><th className="r">Nominal</th><th className="r">Effective</th><th className="r">Interest 3 mo</th><th className="r">Interest {term} mo</th><th className="r">Final balance</th></tr></thead>
          <tbody>
            {[...dep].sort((a, b) => b.finalBalance - a.finalBalance).map((d) => (
              <tr key={d.product.id} className={(best?.product.id === d.product.id ? "best " : "") + (d.termOk ? "" : "dim")}>
                <td>
                  <div className="pname"><span className="id">{d.product.id}</span>{d.product.name}{best?.product.id === d.product.id && <span className="pill-best">BEST</span>}</div>
                  <div className="tags"><span className="tag">{d.product.access}</span>{!d.termOk && <span className="tag warn">min {d.product.minTerm} mo</span>}</div>
                </td>
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
        <div className="card">
          <div className="card-head"><div><h3 className="t">Growth with {best.product.name}</h3><p className="hint">Interest earned over {term} months: <b>{kzt(best.interest)}</b></p></div></div>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Deposit balance growth chart">
            <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
            {[0, 0.5, 1].map((f) => <line key={f} className="grid-l" x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} />)}
            <path className="c-area" d={`${line(s)}L${x(s.length - 1)},${H - padB}L${x(0)},${H - padB}Z`} />
            <path className="c-contrib" d={line(contrib)} />
            <path className="c-line" d={line(s)} />
            <text x={padL} y={H - 5}>Month 0</text>
            <text x={W - padR} y={H - 5} textAnchor="end">Month {term}</text>
          </svg>
          <div className="chart-legend"><span>Balance</span><span className="m">Your contributions</span></div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div><h3 className="t">Goal completion</h3><p className="hint">Time to save the purchase price plus a 1-month buffer, using {best ? best.product.name : "the best deposit"}.</p></div></div>
        <Money label="Goal amount" value={goal} onChange={p.setGoal} />
        <div className="goal">
          <div className="stat"><small>Saving {kzt(base)}/mo</small><b><Months m={mBase} /></b>{mBase !== null && mBase > 0 && <span className="sub2">≈ {addMonths(mBase)}</span>}</div>
          <div className="stat hl"><small>+ {Math.round(inp.trimPct * 100)}% Entertainment trim ({kzt(base + trimAmt)}/mo)</small><b><Months m={mTrim} /></b>{mTrim !== null && mTrim > 0 && <span className="sub2">≈ {addMonths(mTrim)}</span>}</div>
        </div>
        {saved !== null && saved > 0.05 && (
          <div className="rec" style={{ marginTop: 14 }}><Icon n="trend" /><div>Trimming Entertainment by {Math.round(inp.trimPct * 100)}% gets you there about <b>{saved >= 1 ? `${saved.toFixed(1)} months` : `${Math.max(1, Math.round(saved * 4.35))} week${Math.round(saved * 4.35) > 1 ? "s" : ""}`}</b> sooner.</div></div>
        )}
      </div>
    </div>
  );
}
