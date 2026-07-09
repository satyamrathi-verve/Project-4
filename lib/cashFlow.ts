import { supabase } from "@/lib/supabase";
import { parseISODate, todayMidnight, addCalendarDays, toISODate } from "@/lib/format";
import type { AgingBucket } from "@/types/cashFlow";

/*
  Data layer for the Cash Flow Projections screen, reading through the same
  Supabase client as the rest of the app (lib/supabase.ts) — no service role,
  no server-only calls. Dates in/out are plain "YYYY-MM-DD" strings, matching
  every other screen. UI intentionally not built yet (see task scope).
*/

export interface Result<T> {
  data: T | null;
  error: string | null;
}

export interface DateRange {
  /** Inclusive, "YYYY-MM-DD". */
  from: string;
  /** Inclusive, "YYYY-MM-DD". */
  to: string;
}

function notConfigured<T>(): Result<T> {
  return { data: null, error: "Supabase isn't configured." };
}

// ---------------------------------------------------------------------------
// getProjectionsSummary
// ---------------------------------------------------------------------------

export interface ProjectionsSummary {
  /** Sum of expected_amount for projections with expected_date in range. */
  projectedInflow: number;
  /**
   * Average per-row accuracy, 100 - |actual - expected| / expected * 100,
   * clamped to [0, 100], over rows in range that have an actual recorded.
   * null when nothing in range has an actual yet (nothing to score).
   */
  forecastAccuracyPct: number | null;
  /** Sum of expected_amount still unrealized (no actual) whose expected_date has already passed. */
  overdueAmount: number;
  /**
   * Days Sales Outstanding — a whole-portfolio AR metric (outstanding ÷
   * trailing-90-day invoicing × 90), computed the same way as the Dashboard
   * screen so the two always agree. Deliberately NOT scoped to `range`: DSO
   * is "as of today," not a forecast-window figure.
   */
  dso: number;
}

export async function getProjectionsSummary(range: DateRange): Promise<Result<ProjectionsSummary>> {
  if (!supabase) return notConfigured();

  const { data: rows, error } = await supabase
    .from("cash_flow_projections")
    .select("expected_amount, expected_date, actual_amount")
    .gte("expected_date", range.from)
    .lte("expected_date", range.to);

  if (error) return { data: null, error: error.message };

  const today = todayMidnight();
  let projectedInflow = 0;
  let overdueAmount = 0;
  let accuracySum = 0;
  let accuracyCount = 0;

  for (const r of rows ?? []) {
    const expected = Number(r.expected_amount);
    projectedInflow += expected;

    if (r.actual_amount === null || r.actual_amount === undefined) {
      if (parseISODate(r.expected_date) < today) overdueAmount += expected;
    } else if (expected > 0) {
      const actual = Number(r.actual_amount);
      const rowAccuracy = Math.max(0, 100 - (Math.abs(actual - expected) / expected) * 100);
      accuracySum += rowAccuracy;
      accuracyCount += 1;
    }
  }

  const dso = await computeDso();

  return {
    data: {
      projectedInflow,
      forecastAccuracyPct: accuracyCount > 0 ? accuracySum / accuracyCount : null,
      overdueAmount,
      dso,
    },
    error: null,
  };
}

/** Same formula as app/dashboard/page.tsx's DSO tile — kept in sync deliberately. */
async function computeDso(): Promise<number> {
  if (!supabase) return 0;

  const [{ data: invoices }, { data: allocations }] = await Promise.all([
    supabase.from("invoices").select("id, invoice_date, total, status"),
    supabase.from("receipt_allocations").select("invoice_id, amount"),
  ]);

  const allocByInvoice: Record<string, number> = {};
  for (const a of allocations ?? []) {
    allocByInvoice[a.invoice_id] = (allocByInvoice[a.invoice_id] ?? 0) + Number(a.amount);
  }

  const today = todayMidnight();
  const in90 = addCalendarDays(today, -90);

  let totalOutstanding = 0;
  let creditSales90 = 0;
  for (const inv of invoices ?? []) {
    const outstanding = Number(inv.total) - (allocByInvoice[inv.id] ?? 0);
    if (inv.status !== "paid" && outstanding > 0.005) totalOutstanding += outstanding;
    if (parseISODate(inv.invoice_date) >= in90) creditSales90 += Number(inv.total);
  }

  return creditSales90 > 0 ? (totalOutstanding / creditSales90) * 90 : 0;
}

// ---------------------------------------------------------------------------
// getProjectionsByCustomer
// ---------------------------------------------------------------------------

export interface CustomerProjectionRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  expectedTotal: number;
  actualTotal: number;
  /** actualTotal - expectedTotal (negative = came in short of plan). */
  variance: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d60plus: number;
}

export async function getProjectionsByCustomer(range: DateRange, searchTerm?: string): Promise<Result<CustomerProjectionRow[]>> {
  if (!supabase) return notConfigured();

  const { data: rows, error } = await supabase
    .from("cash_flow_projections")
    .select("customer_id, expected_amount, actual_amount, aging_bucket, customers(code, name)")
    .gte("expected_date", range.from)
    .lte("expected_date", range.to);

  if (error) return { data: null, error: error.message };

  const byCustomer = new Map<string, CustomerProjectionRow>();

  for (const r of rows ?? []) {
    const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    const id = r.customer_id as string;

    let row = byCustomer.get(id);
    if (!row) {
      row = {
        customerId: id,
        customerCode: customer?.code ?? "",
        customerName: customer?.name ?? "—",
        expectedTotal: 0,
        actualTotal: 0,
        variance: 0,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d60plus: 0,
      };
      byCustomer.set(id, row);
    }

    const expected = Number(r.expected_amount);
    row.expectedTotal += expected;
    if (r.actual_amount !== null && r.actual_amount !== undefined) row.actualTotal += Number(r.actual_amount);

    const bucket = r.aging_bucket as AgingBucket;
    if (bucket === "current") row.current += expected;
    else if (bucket === "1-30") row.d1_30 += expected;
    else if (bucket === "31-60") row.d31_60 += expected;
    else row.d60plus += expected;
  }

  let result = Array.from(byCustomer.values()).map((r) => ({ ...r, variance: r.actualTotal - r.expectedTotal }));

  if (searchTerm && searchTerm.trim()) {
    const q = searchTerm.trim().toLowerCase();
    result = result.filter((r) => r.customerName.toLowerCase().includes(q) || r.customerCode.toLowerCase().includes(q));
  }

  result.sort((a, b) => b.expectedTotal - a.expectedTotal);

  return { data: result, error: null };
}

// ---------------------------------------------------------------------------
// getForecastVsActualSeries
// ---------------------------------------------------------------------------

export type Granularity = "daily" | "weekly" | "monthly" | "13week";

export interface ForecastVsActualPoint {
  /** Display label, e.g. "9 Jul", "Jul 2026". */
  period: string;
  /** ISO date of the bucket's start — for sorting/chart axis use. */
  periodStart: string;
  expected: number;
  /** null when nothing in this bucket has an actual recorded yet. */
  actual: number | null;
}

interface Period {
  start: Date;
  end: Date; // exclusive
  label: string;
}

// Horizon per granularity — daily/weekly/monthly match the windows already
// used on the existing Cashflow Projection screen; "13week" is the classic
// 13-week treasury cash-flow forecast, always exactly 13 weekly buckets.
const GRANULARITY_WINDOW: Record<Granularity, { unit: "day" | "week" | "month"; count: number }> = {
  daily: { unit: "day", count: 30 },
  weekly: { unit: "week", count: 12 },
  monthly: { unit: "month", count: 6 },
  "13week": { unit: "week", count: 13 },
};

function buildPeriods(today: Date, unit: "day" | "week" | "month", count: number): Period[] {
  const periods: Period[] = [];
  if (unit === "day") {
    for (let i = 0; i < count; i++) {
      const start = addCalendarDays(today, i);
      const end = addCalendarDays(today, i + 1);
      periods.push({ start, end, label: start.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) });
    }
  } else if (unit === "week") {
    for (let i = 0; i < count; i++) {
      const start = addCalendarDays(today, i * 7);
      const end = addCalendarDays(today, (i + 1) * 7);
      periods.push({ start, end, label: start.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) });
    }
  } else {
    const y = today.getFullYear();
    const m = today.getMonth();
    for (let i = 0; i < count; i++) {
      const start = new Date(y, m + i, 1);
      const end = new Date(y, m + i + 1, 1);
      periods.push({ start, end, label: start.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) });
    }
  }
  return periods;
}

export async function getForecastVsActualSeries(granularity: Granularity): Promise<Result<ForecastVsActualPoint[]>> {
  if (!supabase) return notConfigured();

  const { unit, count } = GRANULARITY_WINDOW[granularity];
  const today = todayMidnight();
  const periods = buildPeriods(today, unit, count);

  const rangeFrom = toISODate(periods[0].start);
  const rangeTo = toISODate(periods[periods.length - 1].end);

  const { data: rows, error } = await supabase
    .from("cash_flow_projections")
    .select("expected_amount, expected_date, actual_amount")
    .gte("expected_date", rangeFrom)
    .lt("expected_date", rangeTo);

  if (error) return { data: null, error: error.message };

  const points: ForecastVsActualPoint[] = periods.map((p) => ({
    period: p.label,
    periodStart: toISODate(p.start),
    expected: 0,
    actual: null,
  }));

  for (const r of rows ?? []) {
    const date = parseISODate(r.expected_date);
    const idx = periods.findIndex((p) => date >= p.start && date < p.end);
    if (idx === -1) continue;

    points[idx].expected += Number(r.expected_amount);
    if (r.actual_amount !== null && r.actual_amount !== undefined) {
      points[idx].actual = (points[idx].actual ?? 0) + Number(r.actual_amount);
    }
  }

  return { data: points, error: null };
}
