"use client";

import { useEffect, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import type { Customer, Invoice, ReceiptMode } from "@/lib/types";

const MODES: ReceiptMode[] = ["cash", "cheque", "upi", "neft"];

type OpenInvoice = Invoice & { outstanding: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ReceiptsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const [customerId, setCustomerId] = useState("");
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  const [receiptNo, setReceiptNo] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ReceiptMode>("cash");
  const [reference, setReference] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadCustomers() {
    if (!supabase) return;
    setLoadingCustomers(true);
    const { data, error } = await supabase.from("customers").select("*").order("name");
    if (error) setError(error.message);
    else setCustomers(data ?? []);
    setLoadingCustomers(false);
  }

  async function loadNextReceiptNo() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("receipts")
      .select("receipt_no")
      .order("receipt_no", { ascending: false })
      .limit(1);
    if (error) {
      setError(error.message);
      return;
    }
    const last = data?.[0]?.receipt_no as string | undefined;
    const lastNum = last ? parseInt(last.replace(/\D/g, ""), 10) || 0 : 0;
    setReceiptNo(`RCP-${String(lastNum + 1).padStart(4, "0")}`);
  }

  useEffect(() => {
    loadCustomers();
    loadNextReceiptNo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInvoicesForCustomer(custId: string) {
    if (!supabase || !custId) {
      setInvoices([]);
      setAllocations({});
      return;
    }
    setLoadingInvoices(true);
    setError(null);

    const { data: invData, error: invErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", custId)
      .in("status", ["open", "partial"])
      .order("invoice_date", { ascending: true });

    if (invErr) {
      setError(invErr.message);
      setLoadingInvoices(false);
      return;
    }

    const invList = invData ?? [];
    const ids = invList.map((i) => i.id);
    const allocByInvoice: Record<string, number> = {};

    if (ids.length > 0) {
      const { data: allocData, error: allocErr } = await supabase
        .from("receipt_allocations")
        .select("invoice_id, amount")
        .in("invoice_id", ids);
      if (allocErr) {
        setError(allocErr.message);
        setLoadingInvoices(false);
        return;
      }
      for (const row of allocData ?? []) {
        allocByInvoice[row.invoice_id] = round2((allocByInvoice[row.invoice_id] ?? 0) + Number(row.amount));
      }
    }

    const withOutstanding: OpenInvoice[] = invList.map((inv) => ({
      ...inv,
      outstanding: round2(Number(inv.total) - (allocByInvoice[inv.id] ?? 0)),
    }));

    setInvoices(withOutstanding);
    setAllocations({});
    setLoadingInvoices(false);
  }

  useEffect(() => {
    loadInvoicesForCustomer(customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const allocatedTotal = round2(Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0));
  const receiptAmount = round2(Number(amount) || 0);
  const remaining = round2(receiptAmount - allocatedTotal);
  const overAllocated = remaining < -0.001;

  function setAllocation(invoiceId: string, value: number, cap: number) {
    const clamped = Math.max(0, Math.min(round2(Number.isFinite(value) ? value : 0), cap));
    setAllocations((prev) => ({ ...prev, [invoiceId]: clamped }));
  }

  function autoAllocate() {
    let remainingAmt = receiptAmount;
    const next: Record<string, number> = {};
    for (const inv of invoices) {
      if (remainingAmt <= 0) break;
      const take = round2(Math.min(inv.outstanding, remainingAmt));
      if (take > 0) {
        next[inv.id] = take;
        remainingAmt = round2(remainingAmt - take);
      }
    }
    setAllocations(next);
  }

  function resetForm() {
    setCustomerId("");
    setInvoices([]);
    setAllocations({});
    setAmount("");
    setMode("cash");
    setReference("");
    setReceiptDate(todayISO());
    loadNextReceiptNo();
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);

    if (!supabase) return;
    if (!customerId) {
      setError("Pick a customer first.");
      return;
    }
    if (!receiptNo.trim()) {
      setError("Receipt number is required.");
      return;
    }
    if (receiptAmount <= 0) {
      setError("Enter a receipt amount greater than 0.");
      return;
    }
    if (overAllocated) {
      setError("Allocated amount can't exceed the receipt amount.");
      return;
    }

    const toAllocate = invoices
      .map((inv) => ({ inv, amt: round2(allocations[inv.id] ?? 0) }))
      .filter((x) => x.amt > 0);

    const customer = customers.find((c) => c.id === customerId);
    const confirmMsg = `Post receipt ${receiptNo} for ₹${receiptAmount.toFixed(2)} from ${
      customer?.name ?? "this customer"
    }${toAllocate.length > 0 ? `, allocated across ${toAllocate.length} invoice(s)` : " (unallocated / on account)"}?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);

    const { data: receiptRow, error: receiptErr } = await supabase
      .from("receipts")
      .insert({
        receipt_no: receiptNo.trim(),
        receipt_date: receiptDate,
        customer_id: customerId,
        amount: receiptAmount,
        mode,
        reference: reference.trim() || null,
      })
      .select()
      .single();

    if (receiptErr || !receiptRow) {
      setError(receiptErr?.message ?? "Failed to save the receipt.");
      setSaving(false);
      return;
    }

    if (toAllocate.length > 0) {
      const allocRows = toAllocate.map(({ inv, amt }) => ({
        receipt_id: receiptRow.id,
        invoice_id: inv.id,
        amount: amt,
      }));
      const { error: allocErr } = await supabase.from("receipt_allocations").insert(allocRows);
      if (allocErr) {
        setError(allocErr.message);
        setSaving(false);
        return;
      }

      for (const { inv, amt } of toAllocate) {
        const newOutstanding = round2(inv.outstanding - amt);
        const newStatus = newOutstanding <= 0.001 ? "paid" : "partial";
        const { error: statusErr } = await supabase
          .from("invoices")
          .update({ status: newStatus })
          .eq("id", inv.id);
        if (statusErr) {
          setError(statusErr.message);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    setSuccess(
      `Receipt ${receiptNo} recorded${toAllocate.length > 0 ? ` and allocated to ${toAllocate.length} invoice(s).` : "."}`
    );
    resetForm();
  }

  const columns: Column<OpenInvoice>[] = [
    { key: "invoice_no", header: "Invoice #" },
    { key: "invoice_date", header: "Date" },
    { key: "due_date", header: "Due" },
    {
      key: "total",
      header: "Total",
      render: (row) => `₹${Number(row.total).toFixed(2)}`,
      className: "text-right",
    },
    {
      key: "outstanding",
      header: "Outstanding",
      render: (row) => `₹${row.outstanding.toFixed(2)}`,
      className: "text-right",
    },
    {
      key: "allocate",
      header: "Allocate",
      render: (row) => (
        <input
          type="number"
          min={0}
          max={row.outstanding}
          step="0.01"
          className={`${inputClass} w-32 text-right`}
          value={allocations[row.id] ?? ""}
          onChange={(e) => setAllocation(row.id, Number(e.target.value), row.outstanding)}
          placeholder="0.00"
        />
      ),
      className: "text-right",
    },
  ];

  return (
    <>
      <PageHeader title="Receipt Entry" subtitle="Record money received and knock it off open invoices." />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-3 lg:grid-cols-4">
            <FormField label="Customer">
              <select
                className={inputClass}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={loadingCustomers}
              >
                <option value="">{loadingCustomers ? "Loading…" : "Select a customer"}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Receipt No.">
              <input className={inputClass} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} required />
            </FormField>
            <FormField label="Receipt Date">
              <input
                type="date"
                className={inputClass}
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Amount">
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </FormField>
            <FormField label="Mode">
              <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Reference (optional)">
              <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          )}
          {success && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
              {success}
            </div>
          )}

          {customerId && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Open &amp; partial invoices
                </h3>
                <div className="flex items-center gap-4">
                  <p className={`text-sm font-medium ${overAllocated ? "text-rose-600" : "text-slate-600"}`}>
                    Unallocated remaining: ₹{remaining.toFixed(2)}
                  </p>
                  <button
                    type="button"
                    onClick={autoAllocate}
                    disabled={invoices.length === 0 || receiptAmount <= 0}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Auto-allocate (oldest first)
                  </button>
                </div>
              </div>

              {loadingInvoices ? (
                <p className="text-sm text-slate-500">Loading invoices…</p>
              ) : (
                <DataTable columns={columns} rows={invoices} empty="No open or partial invoices for this customer." />
              )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !customerId || receiptAmount <= 0 || overAllocated}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Receipt"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
