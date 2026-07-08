import type { InvoiceStatus } from "@/lib/types";
import { parseISODate, todayMidnight } from "@/lib/format";

/*
  Shared invoice status pill. Per CLAUDE.md: "overdue" is computed from
  due_date < today, not just trusted from the stored `status` column (which
  can go stale since the seed dates are relative to "today"). Every screen
  that shows invoice status should use this so the colour/label always agree.
*/
export type EffectiveStatus = "open" | "partial" | "overdue" | "paid";

export function effectiveStatus(status: InvoiceStatus, dueDate: string): EffectiveStatus {
  if (status === "paid") return "paid";
  if (parseISODate(dueDate) < todayMidnight()) return "overdue";
  return status === "partial" ? "partial" : "open";
}

export function daysOverdue(dueDate: string): number {
  const diff = Math.round((todayMidnight().getTime() - parseISODate(dueDate).getTime()) / 86400000);
  return Math.max(0, diff);
}

const STYLES: Record<EffectiveStatus, string> = {
  open: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const LABELS: Record<EffectiveStatus, string> = {
  open: "Open",
  partial: "Partial",
  overdue: "Overdue",
  paid: "Paid",
};

export function StatusPill({ status, dueDate }: { status: InvoiceStatus; dueDate: string }) {
  const eff = effectiveStatus(status, dueDate);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[eff]}`}>
      {LABELS[eff]}
    </span>
  );
}
