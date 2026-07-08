/*
  Shared display formatting so every screen shows money and dates the same way
  (Ageing, Invoices, Cashflow, Dashboard, …).
*/

export function formatCurrency(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** For full timestamps (e.g. created_at) — unlike formatDate, does not assume a bare date string. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/*
  Below: a second set of helpers (Cashflow/Dashboard) that work with Date
  objects instead of ISO strings — useful for period-bucketing math. Kept
  distinct from the ISO-string helpers above rather than forcing a rewrite.
*/

export const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Parses a `date` column value ("YYYY-MM-DD") as a local-midnight Date, avoiding UTC shift. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local midnight for "today" — the same convention the Ageing report uses. */
export function todayMidnight(): Date {
  return new Date(new Date().toDateString());
}

export function addCalendarDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Inverse of parseISODate — formats a local Date back to "YYYY-MM-DD". */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
