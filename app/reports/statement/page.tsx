"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, Receipt, ReceiptAllocation } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { IconButton, ActionIcons } from "@/components/IconButton";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { formatCurrency, formatDate, todayISO, parseISODate, todayMidnight, daysBetween } from "@/lib/format";

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
      <p className={`text-lg font-bold tabular-nums ${valueClassName}`}>{value}</p>
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
  const [allocations, setAllocations] = useState<ReceiptAllocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [cust, inv, rcpt, alloc] = await Promise.all([
        supabase.from("customers").select("*"),
        supabase.from("invoices").select("*"),
        supabase.from("receipts").select("*"),
        supabase.from("receipt_allocations").select("*"),
      ]);
      const firstError = cust.error || inv.error || rcpt.error || alloc.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setCustomers(cust.data as Customer[]);
      setInvoices(inv.data as Invoice[]);
      setReceipts(rcpt.data as Receipt[]);
      setAllocations(alloc.data as ReceiptAllocation[]);
    })();
  }, []);

  const loaded = customers && invoices && receipts && allocations;

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

  // Most recent receipt date for this customer, for the Payment Summary — "-" if none.
  const lastPaymentDate = useMemo(() => {
    if (!selectedCustomer || !receipts) return null;
    const dates = receipts.filter((r) => r.customer_id === selectedCustomer.id).map((r) => r.receipt_date);
    return dates.length > 0 ? dates.reduce((latest, d) => (d > latest ? d : latest)) : null;
  }, [selectedCustomer, receipts]);

  // Outstanding Aging Summary — per-invoice outstanding (total minus its receipt_allocations,
  // the same rule the AR Ageing report uses), bucketed by days since the invoice date.
  const aging = useMemo(() => {
    const buckets = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    if (!selectedCustomer || !invoices || !allocations) return buckets;
    const allocByInvoice = new Map<string, number>();
    for (const a of allocations) allocByInvoice.set(a.invoice_id, (allocByInvoice.get(a.invoice_id) ?? 0) + a.amount);
    const today = todayMidnight();
    for (const inv of invoices) {
      if (inv.customer_id !== selectedCustomer.id) continue;
      const outstanding = inv.total - (allocByInvoice.get(inv.id) ?? 0);
      if (outstanding <= 0.005) continue;
      const age = daysBetween(parseISODate(inv.invoice_date), today);
      if (age <= 30) buckets.current += outstanding;
      else if (age <= 60) buckets.d31_60 += outstanding;
      else if (age <= 90) buckets.d61_90 += outstanding;
      else buckets.d90plus += outstanding;
    }
    return buckets;
  }, [selectedCustomer, invoices, allocations]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <PageHeader title="Customer Statement" subtitle="A running account of invoices and receipts for one customer." />
        {isConfigured && selectedCustomer && (
          <IconButton label="Print / Save as PDF" variant="primary" onClick={() => window.print()}>
            {ActionIcons.print}
          </IconButton>
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
            <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500 print:hidden">
              Select a customer above to view their statement.
            </div>
          )}

          {selectedCustomer && (
            <>
              <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-4">
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

              <div className="mb-6 border-t border-slate-200 pt-6 dark:border-slate-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment Summary</h3>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <Stat label="Total Invoices" value={formatCurrency(totalDebit)} valueClassName="text-slate-800 dark:text-slate-100" />
                  <StatDivider />
                  <Stat label="Total Receipts" value={formatCurrency(totalCredit)} valueClassName="text-slate-800 dark:text-slate-100" />
                  <StatDivider />
                  <Stat label="Outstanding Balance" value={formatCurrency(closingBalance)} valueClassName="text-brand dark:text-brand-300" />
                  <StatDivider />
                  <Stat
                    label="Last Payment Date"
                    value={lastPaymentDate ? formatDate(lastPaymentDate) : "-"}
                    valueClassName="text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left dark:border-slate-800 dark:print:border-slate-200">
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
                    <tr className="border-t border-slate-300 font-semibold dark:border-slate-700 dark:print:border-slate-300">
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

              <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Outstanding Aging Summary
                </h3>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <Stat label="Current (0–30 days)" value={formatCurrency(aging.current)} valueClassName="text-slate-800 dark:text-slate-100" />
                  <StatDivider />
                  <Stat label="31–60 days" value={formatCurrency(aging.d31_60)} valueClassName="text-amber-600 dark:text-amber-400" />
                  <StatDivider />
                  <Stat label="61–90 days" value={formatCurrency(aging.d61_90)} valueClassName="text-orange-600 dark:text-orange-400" />
                  <StatDivider />
                  <Stat label="90+ days" value={formatCurrency(aging.d90plus)} valueClassName="text-red-600 dark:text-red-400" />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
