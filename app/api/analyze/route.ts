import { NextResponse } from "next/server";
import { analyze, CATEGORIES, type AnalyzeInput } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const t0 = performance.now();
  let body: Partial<AnalyzeInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN);
  const income = num(body.income), savings = num(body.savings), price = num(body.price);
  if ([income, savings, price].some(Number.isNaN) || income <= 0 || price <= 0)
    return NextResponse.json({ error: "Income and price must be positive numbers; savings must be ≥ 0." }, { status: 422 });
  const expenses = Object.fromEntries(CATEGORIES.map((c) => [c, num(body.expenses?.[c]) || 0])) as AnalyzeInput["expenses"];
  const trimPct = Math.min(0.5, Math.max(0, Number(body.trimPct) || 0));
  const result = analyze({ income, savings, price, expenses, trimPct, itemName: String(body.itemName ?? "").slice(0, 60) });
  return NextResponse.json({ ...result, latencyMs: Math.round((performance.now() - t0) * 100) / 100 });
}
