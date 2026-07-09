"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { FormField, inputClass } from "@/components/FormField";
import { DataTable, type Column } from "@/components/DataTable";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { Customer, Invoice, Receipt, ReceiptMode } from "@/lib/types";

/*
  Records money received from a customer and knocks it off their open/partial
  invoices (FIFO by default, user-adjustable). Writes: receipts,
  receipt_allocations, and updates invoices.status.
*/

type OpenInvoice = Invoice & { outstanding: number };

const MODES: { value: ReceiptMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "upi", label: "UPI" },
  { value: "neft", label: "NEFT" },
];

const MODE_LABEL: Record<ReceiptMode, string> = { cash: "Cash", cheque: "Cheque", upi: "UPI", neft: "NEFT" };

const MODE_BADGE: Record<ReceiptMode, string> = {
  cash: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  cheque: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  upi: "bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand-300",
  neft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function nextReceiptNo(existing: string[]) {
  let max = 0;
  for (const no of existing) {
    const m = /^RCP-(\d+)$/.exec(no);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `RCP-${String(max + 1).padStart(4, "0")}`;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ReceiptEntryPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const [customerId, setCustomerId] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("neft");
  const [reference, setReference] = useState("");

  const [previewReceiptNo, setPreviewReceiptNo] = useState("");
  const [recentReceipts, setRecentReceipts] = useState<Receipt[]>([]);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setLoadingCustomers(false);
      return;
    }
    supabase
      .from("customers")
      .select("*")
      .order("name")
      .then(({ data }) => {
        setCustomers(data ?? []);
        setLoadingCustomers(false);
      });
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("receipts")
      .select("*")
      .order("receipt_date", { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as Receipt[];
        setPreviewReceiptNo(nextReceiptNo(rows.map((r) => r.receipt_no)));
        setRecentReceipts(rows.slice(0, 15));
      });
  }, [success]);

  useEffect(() => {
    if (!customerId || !supabase) {
      setInvoices([]);
      setAllocations({});
      return;
    }
    let cancelled = false;
    setLoadingInvoices(true);
    setError(null);

    (async () => {
      const { data: invs } = await supabase!
        .from("invoices")
        .select("*")
        .eq("customer_id", customerId)
        .in("status", ["open", "partial"])
        .order("invoice_date", { ascending: true });
      if (cancelled) return;

      const invoiceIds = (invs ?? []).map((i) => i.id);
      let allocatedByInvoice: Record<string, number> = {};
      if (invoiceIds.length) {
        const { data: allocs } = await supabase!
          .from("receipt_allocations")
          .select("invoice_id, amount")
          .in("invoice_id", invoiceIds);
        allocatedByInvoice = (allocs ?? []).reduce((acc, a) => {
          acc[a.invoice_id] = round2((acc[a.invoice_id] ?? 0) + Number(a.amount));
          return acc;
        }, {} as Record<string, number>);
      }
      if (cancelled) return;

      const withOutstanding: OpenInvoice[] = (invs ?? [])
        .map((inv) => ({ ...inv, outstanding: round2(Number(inv.total) - (allocatedByInvoice[inv.id] ?? 0)) }))
        .filter((inv) => inv.outstanding > 0);

      setInvoices(withOutstanding);
      setAllocations({});
      setLoadingInvoices(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const totalOutstanding = useMemo(() => round2(invoices.reduce((s, inv) => s + inv.outstanding, 0)), [invoices]);

  const amountNum = round2(Number(amount) || 0);

  const allocatedTotal = useMemo(
    () => round2(Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0)),
    [allocations]
  );
  const unallocated = round2(amountNum - allocatedTotal);
  const overAllocated = allocatedTotal > amountNum + 0.005;

  function setAllocation(invoiceId: string, value: string, cap: number) {
    const n = Number(value);
    const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 0), cap) : 0;
    setAllocations((prev) => ({ ...prev, [invoiceId]: value === "" ? "" : String(clamped) }));
  }

  function autoAllocate() {
    if (!amountNum) return;
    let remaining = amountNum;
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      if (remaining <= 0) {
        next[inv.id] = "0";
        continue;
      }
      const take = round2(Math.min(inv.outstanding, remaining));
      next[inv.id] = take ? String(take) : "0";
      remaining = round2(remaining - take);
    }
    setAllocations(next);
  }

  function resetForm() {
    setCustomerId("");
    setReceiptDate(todayISO());
    setAmount("");
    setMode("neft");
    setReference("");
    setInvoices([]);
    setAllocations({});
    setError(null);
  }

  async function handleSave() {
    setError(null);
    if (!supabase) return;
    if (!customerId) return setError("Pick a customer first.");
    if (!receiptDate) return setError("Receipt date is required.");
    if (!amountNum || amountNum <= 0) return setError("Enter a receipt amount greater than zero.");
    if (overAllocated) return setError("Allocated amount exceeds the receipt amount.");

    const customer = customers.find((c) => c.id === customerId);
    const allocEntries = invoices
      .map((inv) => ({ invoice: inv, amount: round2(Number(allocations[inv.id]) || 0) }))
      .filter((a) => a.amount > 0);

    const confirmMsg = `Post receipt of ₹${money(amountNum)} from ${customer?.name ?? "this customer"}${
      allocEntries.length ? ` and allocate it across ${allocEntries.length} invoice(s)` : " (unallocated)"
    }?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    try {
      const { data: existing } = await supabase.from("receipts").select("receipt_no");
      const receiptNo = nextReceiptNo((existing ?? []).map((r) => r.receipt_no));

      const { data: receipt, error: insertErr } = await supabase
        .from("receipts")
        .insert({
          receipt_no: receiptNo,
          receipt_date: receiptDate,
          customer_id: customerId,
          amount: amountNum,
          mode,
          reference: reference || null,
        })
        .select()
        .single();
      if (insertErr || !receipt) throw insertErr ?? new Error("Could not create the receipt.");

      if (allocEntries.length) {
        const { error: allocErr } = await supabase.from("receipt_allocations").insert(
          allocEntries.map((a) => ({ receipt_id: receipt.id, invoice_id: a.invoice.id, amount: a.amount }))
        );
        if (allocErr) throw allocErr;

        await Promise.all(
          allocEntries.map((a) => {
            const newOutstanding = round2(a.invoice.outstanding - a.amount);
            const status = newOutstanding <= 0.005 ? "paid" : "partial";
            return supabase!.from("invoices").update({ status }).eq("id", a.invoice.id);
          })
        );
      }

      setSuccess(`Receipt ${receiptNo} for ₹${money(amountNum)} posted.`);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  }

  if (!isConfigured) {
    return (
      <div>
        <PageHeader title="Receipt Entry" subtitle="Record money received and knock off invoices" />
        <NotConfigured />
      </div>
    );
  }

  const recentReceiptColumns: Column<Receipt>[] = [
    { key: "receipt_no", header: "Receipt No.", render: (r) => <span className="font-medium">{r.receipt_no}</span> },
    { key: "receipt_date", header: "Date", render: (r) => formatDate(r.receipt_date) },
    { key: "customer_id", header: "Customer", render: (r) => customerMap.get(r.customer_id)?.name ?? "Unknown customer" },
    { key: "amount", header: "Amount", className: "text-right tabular-nums", render: (r) => `₹${money(Number(r.amount))}` },
    {
      key: "mode",
      header: "Mode",
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MODE_BADGE[r.mode]}`}>{MODE_LABEL[r.mode]}</span>
      ),
    },
    { key: "reference", header: "Reference", render: (r) => r.reference ?? "—" },
  ];

  const columns: Column<OpenInvoice>[] = [
    { key: "invoice_no", header: "Invoice", render: (r) => <span className="font-medium">{r.invoice_no}</span> },
    { key: "invoice_date", header: "Date", render: (r) => formatDate(r.invoice_date) },
    { key: "due_date", header: "Due", render: (r) => formatDate(r.due_date) },
    {
      key: "total",
      header: "Total",
      className: "text-right tabular-nums",
      render: (r) => money(r.total),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right tabular-nums",
      render: (r) => money(r.outstanding),
    },
    {
      key: "allocate",
      header: "Allocate",
      className: "text-right",
      render: (r) => (
        <input
          type="number"
          min={0}
          max={r.outstanding}
          step="0.01"
          value={allocations[r.id] ?? ""}
          onChange={(e) => setAllocation(r.id, e.target.value, r.outstanding)}
          placeholder="0.00"
          className={`${inputClass} w-28 text-right tabular-nums`}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Receipt Entry" subtitle="Record money received and knock it off open invoices" />

      {success && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Customer">
            <SearchableSelect
              options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder={loadingCustomers ? "Loading customers…" : "Search customers…"}
            />
          </FormField>

          <FormField label="Receipt No.">
            <input className={`${inputClass} text-slate-400 dark:text-slate-500`} value={previewReceiptNo || "…"} disabled readOnly />
          </FormField>

          <FormField label="Receipt Date">
            <input
              type="date"
              className={inputClass}
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
            />
          </FormField>

          <FormField label="Amount">
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${inputClass} tabular-nums`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </FormField>

          <FormField label="Mode">
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Reference">
            <input
              className={inputClass}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque / UTR / txn no."
            />
          </FormField>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Allocate against open invoices
            </h3>
            {customerId && invoices.length > 0 && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Total outstanding for this customer:{" "}
                <span className="font-medium text-slate-600 dark:text-slate-300">₹{money(totalOutstanding)}</span> across{" "}
                {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          {invoices.length > 0 && (
            <button
              type="button"
              onClick={autoAllocate}
              disabled={!amountNum}
              className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-900/30"
            >
              Auto-allocate (oldest first)
            </button>
          )}
        </div>

        {!customerId ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
            Pick a customer to see their open and partial invoices.
          </div>
        ) : loadingInvoices ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
            Loading invoices…
          </div>
        ) : (
          <DataTable columns={columns} rows={invoices} empty="No open or partial invoices for this customer." />
        )}

        {customerId && (
          <div className="mt-3 flex items-center justify-end gap-6 text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              Allocated: <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">₹{money(allocatedTotal)}</span>
            </span>
            <span className={overAllocated ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"}>
              Unallocated remaining:{" "}
              <span className="tabular-nums font-medium">₹{money(unallocated)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={resetForm}
          disabled={saving}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || overAllocated || !customerId || !amountNum}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Receipt"}
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Recent receipts
        </h3>
        <div className="mt-4">
          <DataTable columns={recentReceiptColumns} rows={recentReceipts} empty="No receipts recorded yet." />
        </div>
      </div>
    </div>
  );
}
