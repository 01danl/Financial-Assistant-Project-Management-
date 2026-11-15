// Financial Assistant — decision-support engine (prototype).
// Stage 1: deterministic disposable-income guardrails (CR-002).
// Stage 2: weighted factor scoring that stands in for the Random Forest model
// (the real sklearn model lives in the FastAPI backend; this is a TS port of its logic).

export const CATEGORIES = [
  "Housing / Rent",
  "Groceries",
  "Transport",
  "Education",
  "Healthcare",
  "Entertainment",
  "Subscriptions",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Peer-median share of net income (synthetic KZT student / young-professional segment).
export const PEER_SHARE: Record<Category, number> = {
  "Housing / Rent": 0.31,
  Groceries: 0.25,
  Transport: 0.07,
  Education: 0.03,
  Healthcare: 0.03,
  Entertainment: 0.0847,
  Subscriptions: 0.03,
  Other: 0.04,
};

export interface AnalyzeInput {
  income: number;
  expenses: Record<Category, number>;
  savings: number;
  itemName: string;
  price: number;
  trimPct: number; // what-if trim of Entertainment, 0..0.5
}

export type Verdict = "safe" | "caution" | "high";

export interface Factor {
  title: string;
  weight: number; // 0..100
  text: string;
}

export interface Anomaly {
  category: Category;
  amount: number;
  peer: number;
  pctAbove: number;
}

export interface AnalyzeResult {
  verdict: Verdict;
  verdictLabel: string;
  riskScore: number;
  totalExpenses: number;
  freeCash: number;
  guardrail: number; // 1 month of expenses
  postSavings: number;
  bufferMonthsBefore: number;
  bufferMonthsAfter: number;
  rebuildMonths: number | null;
  factors: Factor[];
  anomalies: Anomaly[];
  recommendation: string;
  plan: { delayMonths: number; monthlySave: number; trimAmount: number; postPurchase: number } | null;
  breakdown: { category: Category; amount: number; share: number; peerShare: number }[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const kzt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n)) + " ₸";

export function analyze(i: AnalyzeInput): AnalyzeResult {
  const totalExpenses = CATEGORIES.reduce((s, c) => s + (i.expenses[c] || 0), 0);
  const freeCash = i.income - totalExpenses;
  const guardrail = totalExpenses; // 1.0-month safety buffer
  const postSavings = i.savings - i.price;
  const bufBefore = guardrail > 0 ? i.savings / guardrail : 99;
  const bufAfter = guardrail > 0 ? Math.max(0, postSavings) / guardrail : 99;
  const shortfall = Math.max(0, guardrail - postSavings);
  const rebuild = shortfall === 0 ? 0 : freeCash > 0 ? shortfall / freeCash : null;

  // discretionary: Entertainment vs peer median
  const entPeer = PEER_SHARE.Entertainment * i.income;
  const ent = i.expenses.Entertainment || 0;
  const entExcess = entPeer > 0 ? Math.max(0, ent / entPeer - 1) : 0;

  // Stage 2: factor risks (0..1) × model weights
  const liqRisk = clamp(1 - bufAfter / 1.0);
  const cashRisk = rebuild === null ? 1 : clamp(rebuild / 5);
  const discRisk = clamp(entExcess / 0.26);
  const riskScore = Math.round(100 * (0.52 * liqRisk + 0.28 * cashRisk + 0.2 * discRisk));

  // Stage 1: hard guardrails first
  let verdict: Verdict;
  if (i.price > i.savings) verdict = "high";
  else if (freeCash <= 0 && postSavings < guardrail) verdict = "high";
  else if (postSavings < guardrail) verdict = rebuild !== null && rebuild > 6 ? "high" : "caution";
  else verdict = riskScore < 40 ? "safe" : riskScore < 70 ? "caution" : "high";
  if (verdict === "safe" && riskScore >= 40) verdict = "caution";

  const verdictLabel = {
    safe: "Feasible — Safe",
    caution: "Feasible — Conditional",
    high: "Not Recommended — High Budget Risk",
  }[verdict];

  const f1 =
    i.price > i.savings
      ? `The ${kzt(i.price)} price is higher than your liquid savings of ${kzt(i.savings)}, so it cannot be paid in cash.`
      : `Paying ${kzt(i.price)} upfront changes liquid savings from ${kzt(i.savings)} to ${kzt(postSavings)} (${bufAfter.toFixed(2)} months of living expenses${bufAfter < 1 ? `, below the 1.0-month safety guardrail of ${kzt(guardrail)}` : ", above the 1.0-month safety guardrail"}).`;
  const f2 =
    freeCash > 0
      ? `Your ${kzt(freeCash)}/month free cash flow ${rebuild ? `can rebuild the safety buffer in ${rebuild.toFixed(1)} months` : "keeps the buffer topped up"}.`
      : `You spend ${kzt(-freeCash)} more than you earn each month, so the buffer cannot be rebuilt from cash flow.`;
  const f3 =
    entExcess > 0.02
      ? `Entertainment (${kzt(ent)}) is ${Math.round(entExcess * 100)}% above the peer median (${kzt(entPeer)}).`
      : `Entertainment (${kzt(ent)}) is in line with the peer median (${kzt(entPeer)}).`;
  const factors: Factor[] = [
    { title: "Liquidity Buffer Erosion", weight: 52, text: f1 },
    { title: freeCash > 0 ? "Positive Monthly Savings Capacity" : "Negative Monthly Cash Flow", weight: 28, text: f2 },
    { title: "Discretionary Trim Opportunity", weight: 20, text: f3 },
  ];

  const breakdown = CATEGORIES.map((c) => ({
    category: c,
    amount: i.expenses[c] || 0,
    share: i.income > 0 ? (i.expenses[c] || 0) / i.income : 0,
    peerShare: PEER_SHARE[c],
  }));
  const anomalies: Anomaly[] = breakdown
    .filter((b) => b.amount > 5000 && b.share > b.peerShare * 1.15)
    .map((b) => ({
      category: b.category,
      amount: b.amount,
      peer: b.peerShare * i.income,
      pctAbove: Math.round((b.share / b.peerShare - 1) * 100),
    }))
    .sort((a, b) => b.pctAbove - a.pctAbove);

  // What-if plan: delay purchase, save free cash + trim until buffer survives purchase
  let plan: AnalyzeResult["plan"] = null;
  let recommendation: string;
  const trimAmount = Math.round(ent * i.trimPct);
  const monthlySave = Math.max(0, freeCash) + trimAmount;
  if (postSavings >= guardrail) {
    recommendation = `You can buy the ${i.itemName || "item"} now and still keep at least one month of expenses (${kzt(guardrail)}). Consider a revocable deposit for the remaining ${kzt(postSavings)}.`;
  } else if (monthlySave > 0) {
    const need = guardrail + i.price - i.savings;
    const delayMonths = Math.ceil(need / monthlySave);
    const post = i.savings + delayMonths * monthlySave - i.price;
    plan = { delayMonths, monthlySave, trimAmount, postPurchase: post };
    recommendation = `Delay the cash purchase by ${delayMonths} month${delayMonths > 1 ? "s" : ""} while depositing ${kzt(Math.max(0, freeCash))}/month${trimAmount ? ` (plus a ${Math.round(i.trimPct * 100)}% trim on Entertainment = ${kzt(monthlySave)}/month)` : ""} into a revocable deposit, so post-purchase savings stay at ${kzt(post)} or more.`;
  } else {
    recommendation = `Purchase is not advisable: there is no free cash flow to rebuild savings. Reduce expenses first.`;
  }

  return {
    verdict, verdictLabel, riskScore, totalExpenses, freeCash, guardrail, postSavings,
    bufferMonthsBefore: bufBefore, bufferMonthsAfter: bufAfter, rebuildMonths: rebuild,
    factors, anomalies, recommendation, plan, breakdown,
  };
}

// ---------- Deposits ----------
export interface DepositProduct {
  id: string;
  name: string;
  nominal: number; // annual, e.g. 0.138
  access: "Withdrawable" | "Partial withdrawal" | "No withdrawal";
  minTerm: number;
}

// Synthetic reference catalog (no live bank data).
export const DEPOSITS: DepositProduct[] = [
  { id: "A", name: "Flexible Daily Deposit", nominal: 0.138, access: "Withdrawable", minTerm: 3 },
  { id: "B", name: "Educational Goal Deposit", nominal: 0.145, access: "Partial withdrawal", minTerm: 6 },
  { id: "C", name: "Maximum Savings Term Deposit", nominal: 0.158, access: "No withdrawal", minTerm: 12 },
  { id: "D", name: "Student Starter Deposit", nominal: 0.125, access: "Withdrawable", minTerm: 3 },
  { id: "E", name: "Salary-Linked Saver", nominal: 0.14, access: "Partial withdrawal", minTerm: 3 },
  { id: "F", name: "Replenishable Goal Saver", nominal: 0.142, access: "Withdrawable", minTerm: 6 },
  { id: "G", name: "Short-Term Fixed (3 mo)", nominal: 0.12, access: "No withdrawal", minTerm: 3 },
  { id: "H", name: "Long-Term Fixed (24+ mo)", nominal: 0.16, access: "No withdrawal", minTerm: 24 },
];

export const effectiveRate = (nominal: number) => Math.pow(1 + nominal / 12, 12) - 1; // GESV-style EAR

export interface DepositResult {
  product: DepositProduct;
  ear: number;
  finalBalance: number;
  interest: number;
  interest3: number;
  contributed: number;
  termOk: boolean;
  series: number[]; // balance by month 0..term
}

export function simulateDeposit(p: DepositProduct, initial: number, monthly: number, term: number): DepositResult {
  let b = initial;
  let interest = 0, interest3 = 0;
  const series = [b];
  for (let m = 1; m <= term; m++) {
    const it = (b * p.nominal) / 12;
    b += it + monthly;
    interest += it;
    if (m === 3) interest3 = interest;
    series.push(b);
  }
  if (term < 3) interest3 = interest;
  return {
    product: p, ear: effectiveRate(p.nominal), finalBalance: b, interest, interest3,
    contributed: initial + monthly * term, termOk: term >= p.minTerm, series,
  };
}

export function monthsToGoal(nominal: number, initial: number, monthly: number, goal: number, cap = 120): number | null {
  let b = initial;
  if (b >= goal) return 0;
  for (let m = 1; m <= cap; m++) {
    const prev = b;
    b += (b * nominal) / 12 + monthly;
    if (b >= goal) return m - 1 + (goal - prev) / (b - prev); // fractional month
    if (b <= prev) return null;
  }
  return null;
}

export const SCENARIO_4: AnalyzeInput = {
  income: 350000,
  expenses: {
    "Housing / Rent": 110000, Groceries: 85000, Transport: 25000, Education: 0, Healthcare: 0,
    Entertainment: 35000, Subscriptions: 10000, Other: 10000,
  },
  savings: 520000,
  itemName: "Engineering Laptop",
  price: 450000,
  trimPct: 0.15,
};
