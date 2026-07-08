import type { InvoiceStatus } from "@/lib/types";

const STYLES: Record<InvoiceStatus, string> = {
  open: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const LABELS: Record<InvoiceStatus, string> = {
  open: "Open",
  partial: "Partial",
  paid: "Paid",
  overdue: "Overdue",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
