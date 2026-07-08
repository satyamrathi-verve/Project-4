"use client";

import { useEffect, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";

/*
  AR Ageing report: for each customer, take their unpaid/partial invoices,
  compute each one's outstanding (total minus allocated receipts), and bucket
  it by today - due_date. One row per customer, plus a grand-total row.
*/
type Bucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus";

interface AgeingRow {
  id: string;
  name: string;
  notDue: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

const BUCKET_COLS: { key: Bucket; header: string }[] = [
  { key: "notDue", header: "Not Due" },
  { key: "d0_30", header: "0–30 days" },
  { key: "d31_60", header: "31–60 days" },
  { key: "d61_90", header: "61–90 days" },
  { key: "d90plus", header: "90+ days" },
];

function todayMidnight() {
  return new Date(new Date().toDateString());
}

function bucketFor(dueDate: string): Bucket {
  const due = new Date(dueDate + "T00:00:00");
  const today = todayMidnight();
  if (due >= today) return "notDue";
  const daysPastDue = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (daysPastDue <= 30) return "d0_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90plus";
}

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AgeingReportPage() {
  const [rows, setRows] = useState<AgeingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    setAsOf(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }));
    if (!supabase) return;

    (async () => {
      const [{ data: customers, error: custErr }, { data: invoices, error: invErr }, { data: allocations, error: allocErr }] =
        await Promise.all([
          supabase.from("customers").select("*"),
          supabase.from("invoices").select("*").in("status", ["open", "partial", "overdue"]),
          supabase.from("receipt_allocations").select("*"),
        ]);

      if (custErr || invErr || allocErr) {
        setError(custErr?.message || invErr?.message || allocErr?.message || "Failed to load report.");
        return;
      }

      const allocatedByInvoice = new Map<string, number>();
      for (const a of (allocations ?? []) as ReceiptAllocation[]) {
        allocatedByInvoice.set(a.invoice_id, (allocatedByInvoice.get(a.invoice_id) ?? 0) + a.amount);
      }

      const byCustomer = new Map<string, AgeingRow>();
      for (const c of (customers ?? []) as Customer[]) {
        byCustomer.set(c.id, { id: c.id, name: c.name, notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });
      }

      for (const inv of (invoices ?? []) as Invoice[]) {
        const outstanding = inv.total - (allocatedByInvoice.get(inv.id) ?? 0);
        if (outstanding <= 0.005) continue;
        const row = byCustomer.get(inv.customer_id);
        if (!row) continue;
        const bucket = bucketFor(inv.due_date);
        row[bucket] += outstanding;
        row.total += outstanding;
      }

      const result = Array.from(byCustomer.values())
        .filter((r) => r.total > 0.005)
        .sort((a, b) => b.total - a.total);

      setRows(result);
    })();
  }, []);

  const grandTotal: AgeingRow = {
    id: "total",
    name: "Grand Total",
    notDue: 0,
    d0_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90plus: 0,
    total: 0,
  };
  for (const r of rows ?? []) {
    grandTotal.notDue += r.notDue;
    grandTotal.d0_30 += r.d0_30;
    grandTotal.d31_60 += r.d31_60;
    grandTotal.d61_90 += r.d61_90;
    grandTotal.total += r.total;
    grandTotal.d90plus += r.d90plus;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-end justify-between gap-4 print:hidden">
        <PageHeader title="AR Ageing Report" subtitle={`Outstanding by age bucket, as of ${asOf}`} />
        {isConfigured && rows && rows.length > 0 && (
          <button
            type="button"
            onClick={() => window.print()}
            className="mb-6 flex-none rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
          >
            Print
          </button>
        )}
      </div>

      {/* Print-only header, since the app chrome is hidden when printing */}
      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold text-brand">AR Ageing Report</h1>
        <p className="text-sm text-slate-500">As of {asOf}</p>
      </div>

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load the ageing report.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && rows === null && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      )}

      {isConfigured && !error && rows && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Customer</th>
                {BUCKET_COLS.map((b) => (
                  <th key={b.key} className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                    {b.header}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Total Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                    Nothing outstanding — every invoice is fully paid.
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">{r.name}</td>
                      {BUCKET_COLS.map((b) => (
                        <td key={b.key} className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">
                          {r[b.key] > 0 ? formatCurrency(r[b.key]) : "–"}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold text-brand dark:text-brand-300">
                        {formatCurrency(r.total)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold dark:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-100">Grand Total</td>
                    {BUCKET_COLS.map((b) => (
                      <td key={b.key} className="px-4 py-3 text-right text-slate-800 dark:text-slate-100">
                        {formatCurrency(grandTotal[b.key])}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right text-brand dark:text-brand-300">{formatCurrency(grandTotal.total)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
