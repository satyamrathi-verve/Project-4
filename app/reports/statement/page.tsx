"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";

/*
  Customer Statement (ledger): every invoice (a debit, at its full total) and
  every receipt (a credit, at its full amount) for one customer, merged into a
  single date-ordered list with a running balance that starts at the
  customer's opening_balance. The last row's balance is their total
  outstanding — debits/credits always reconcile to it by construction, since
  the running balance is just opening_balance + (sum of debits so far) -
  (sum of credits so far).
*/

interface LedgerEntry {
  id: string;
  date: string;
  particulars: string;
  debit: number;
  credit: number;
  docNo: string;
  kind: "invoice" | "receipt";
}

interface LedgerRow extends LedgerEntry {
  balance: number;
}

function Stat({ label, value, valueClassName }: { label: string; value: string; valueClassName: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-base font-bold tabular-nums ${valueClassName}`}>{value}</p>
    </div>
  );
}

function StatDivider() {
  return <span className="hidden h-8 w-px bg-slate-200 dark:bg-slate-800 sm:block" />;
}

export default function CustomerStatementPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [cust, inv, rcpt] = await Promise.all([
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("receipts").select("*"),
      ]);
      const firstError = cust.error || inv.error || rcpt.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setCustomers(cust.data as Customer[]);
      setInvoices(inv.data as Invoice[]);
      setReceipts(rcpt.data as Receipt[]);
    })();
  }, []);

  const loaded = customers && invoices && receipts;

  const sortedCustomers = useMemo(() => {
    return [...(customers ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [customers]);

  const selectedCustomer = useMemo(
    () => customers?.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const rows = useMemo<LedgerRow[]>(() => {
    if (!selectedCustomer || !invoices || !receipts) return [];

    const entries: LedgerEntry[] = [
      ...invoices
        .filter((inv) => inv.customer_id === selectedCustomer.id)
        .map((inv) => ({
          id: inv.id,
          date: inv.invoice_date,
          particulars: `Invoice ${inv.invoice_no}`,
          debit: inv.total,
          credit: 0,
          docNo: inv.invoice_no,
          kind: "invoice" as const,
        })),
      ...receipts
        .filter((r) => r.customer_id === selectedCustomer.id)
        .map((r) => ({
          id: r.id,
          date: r.receipt_date,
          particulars: `Receipt ${r.receipt_no}`,
          debit: 0,
          credit: r.amount,
          docNo: r.receipt_no,
          kind: "receipt" as const,
        })),
    ];

    // Strict date order; same-day ties settle by putting the debit before the
    // credit, then by document number, so the ledger reads deterministically.
    entries.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
      return a.docNo.localeCompare(b.docNo);
    });

    let balance = selectedCustomer.opening_balance;
    return entries.map((e) => {
      balance += e.debit - e.credit;
      return { ...e, balance };
    });
  }, [selectedCustomer, invoices, receipts]);

  const totalDebit = useMemo(() => rows.reduce((s, r) => s + r.debit, 0), [rows]);
  const totalCredit = useMemo(() => rows.reduce((s, r) => s + r.credit, 0), [rows]);
  const openingBalance = selectedCustomer?.opening_balance ?? 0;
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance;
  const asOfLabel = formatDate(todayISO());

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <PageHeader title="Customer Statement" subtitle="A running account of invoices and receipts for one customer." />
        {isConfigured && selectedCustomer && (
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
          >
            Print
          </button>
        )}
      </div>

      {/* Print-only header, since the app chrome is hidden when printing */}
      {selectedCustomer && (
        <div className="mb-4 hidden print:block">
          <h1 className="text-xl font-bold text-brand">Customer Statement</h1>
          <p className="text-sm text-slate-500">
            {selectedCustomer.name} ({selectedCustomer.code}) · as of {asOfLabel}
          </p>
        </div>
      )}

      {!isConfigured && <NotConfigured />}

      {isConfigured && error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load the statement.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {isConfigured && !error && !loaded && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {isConfigured && !error && loaded && (
        <>
          <div className="mb-4 max-w-sm print:hidden">
            <FormField label="Customer">
              <select className={inputClass} value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}>
                <option value="">Select a customer…</option>
                {sortedCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {!selectedCustomer && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 print:hidden">
              Select a customer above to view their statement.
            </div>
          )}

          {selectedCustomer && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{selectedCustomer.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{selectedCustomer.code}</p>
                </div>
                <StatDivider />
                <Stat label="Opening Balance" value={formatCurrency(openingBalance)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label="Total Debits" value={formatCurrency(totalDebit)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label="Total Credits" value={formatCurrency(totalCredit)} valueClassName="text-slate-800 dark:text-slate-100" />
                <StatDivider />
                <Stat label="Closing Balance" value={formatCurrency(closingBalance)} valueClassName="text-brand dark:text-brand-300" />
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:print:border-slate-200 dark:print:bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50 dark:print:border-slate-200 dark:print:bg-slate-50">
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Date</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Particulars</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Debit</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Credit</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300 dark:print:text-slate-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100 dark:border-slate-800 dark:print:border-slate-100">
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 dark:print:text-slate-400">—</td>
                      <td className="px-4 py-3 font-medium italic text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Opening Balance</td>
                      <td className="px-4 py-3 text-right text-slate-400 dark:text-slate-500 dark:print:text-slate-400">–</td>
                      <td className="px-4 py-3 text-right text-slate-400 dark:text-slate-500 dark:print:text-slate-400">–</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                        {formatCurrency(openingBalance)}
                      </td>
                    </tr>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500 dark:print:text-slate-400">
                          No invoices or receipts recorded for this customer yet.
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 dark:print:border-slate-100">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300 dark:print:text-slate-700">{formatDate(r.date)}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                            {r.kind === "invoice" ? (
                              <Link href={`/invoices/${r.id}`} className="text-brand hover:underline dark:text-brand-300 print:text-slate-700 print:no-underline">
                                {r.particulars}
                              </Link>
                            ) : (
                              r.particulars
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                            {r.debit > 0 ? formatCurrency(r.debit) : "–"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                            {r.credit > 0 ? formatCurrency(r.credit) : "–"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-slate-700 dark:text-slate-300 dark:print:text-slate-700">
                            {formatCurrency(r.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                    <tr className="bg-slate-50 font-semibold dark:bg-slate-800/50 dark:print:bg-slate-50">
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-100 dark:print:text-slate-800" colSpan={2}>
                        Closing Balance
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 dark:print:text-slate-800">
                        {formatCurrency(totalDebit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800 dark:text-slate-100 dark:print:text-slate-800">
                        {formatCurrency(totalCredit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-brand dark:text-brand-300 dark:print:text-brand">
                        {formatCurrency(closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
