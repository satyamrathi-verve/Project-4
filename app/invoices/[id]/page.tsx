"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, InvoiceItem, Receipt, ReceiptAllocation, ReceiptMode } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Attachments } from "@/components/Attachments";
import { FormField, inputClass } from "@/components/FormField";
import { formatCurrency, formatDate, formatDateTime, todayISO, round2 } from "@/lib/format";
import { balanceDue, displayStatus, parseNotes, computeDiscountAmount, computeTaxRows, buildAllocationMap, paidAmount, TERMS_AND_CONDITIONS } from "@/lib/invoice";

const RECEIPT_MODES: ReceiptMode[] = ["cash", "cheque", "upi", "neft"];

interface PaymentRow {
  id: string;
  receipt_no: string;
  receipt_date: string;
  mode: string;
  amount: number;
}

interface LastInvoiceSummary {
  invoice_no: string;
  invoice_date: string;
  balance: number;
}

// Panel chrome, forced back to light on the printed page regardless of the
// screen's current dark-mode toggle — paper is white either way.
const PANEL = "rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 dark:print:border-slate-200 dark:print:bg-white print:break-inside-avoid";
const LABEL = "text-slate-400 dark:text-slate-500 dark:print:text-slate-500";
const BODY = "text-slate-600 dark:text-slate-300 dark:print:text-slate-600";

// Placeholder company bank details — same on every invoice, so no schema for it either.
// There's no real bank data anywhere in the backend, so these are examples: replace
// with the company's actual account details before this is used for a real invoice.
const BANK_DETAILS: { label: string; value: string }[] = [
  { label: "Mode of Payment", value: "Bank Transfer / NEFT / RTGS / UPI" },
  { label: "Bank Name", value: "HDFC Bank" },
  { label: "Account No.", value: "50200012345678" },
  { label: "Account Type", value: "Current Account" },
  { label: "IFSC Code", value: "HDFC0001234" },
  { label: "MICR No.", value: "411240002" },
];

export default function InvoiceViewPage({ params }: { params: { id: string } }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [paymentMode, setPaymentMode] = useState<ReceiptMode>("neft");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<LastInvoiceSummary | null>(null);
  const [previousOutstanding, setPreviousOutstanding] = useState(0);
  const printedRef = useRef(false);

  async function loadInvoice() {
    if (!supabase) return;
    const [{ data: inv, error: invErr }, { data: comp, error: compErr }, { data: itemRows, error: itemErr }, { data: allocations, error: allocErr }] =
      await Promise.all([
        supabase.from("invoices").select("*").eq("id", params.id).single(),
        supabase.from("company").select("*").limit(1).single(),
        supabase.from("invoice_items").select("*").eq("invoice_id", params.id).order("id"),
        supabase.from("receipt_allocations").select("*").eq("invoice_id", params.id),
      ]);

    if (invErr || !inv) {
      setError(invErr?.message || "Invoice not found.");
      return;
    }
    if (itemErr || allocErr) {
      setError(itemErr?.message || allocErr?.message || "Failed to load invoice details.");
      return;
    }
    setInvoice(inv as Invoice);
    setCompany((comp as Company) ?? null);
    setItems((itemRows ?? []) as InvoiceItem[]);

    const { data: custData, error: custErr } = await supabase.from("customers").select("*").eq("id", inv.customer_id).single();
    if (custErr) {
      setError(custErr.message);
      return;
    }
    setCustomer(custData as Customer);

    // Other invoices for this customer, to show the previous balance up top.
    const { data: otherInvoices, error: otherErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("customer_id", inv.customer_id)
      .neq("id", inv.id);
    if (!otherErr && otherInvoices) {
      const others = otherInvoices as Invoice[];
      const otherIds = others.map((o) => o.id);
      let otherAllocs: ReceiptAllocation[] = [];
      if (otherIds.length > 0) {
        const { data: allocData } = await supabase.from("receipt_allocations").select("*").in("invoice_id", otherIds);
        otherAllocs = (allocData ?? []) as ReceiptAllocation[];
      }
      const otherAllocMap = buildAllocationMap(otherAllocs);
      const totalPrevOutstanding = others.reduce(
        (sum, o) => sum + Math.max(0, balanceDue(o, paidAmount(o.id, otherAllocMap))),
        0
      );
      setPreviousOutstanding(round2(totalPrevOutstanding));

      const mostRecent = [...others].sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1))[0];
      setLastInvoice(
        mostRecent
          ? {
              invoice_no: mostRecent.invoice_no,
              invoice_date: mostRecent.invoice_date,
              balance: round2(balanceDue(mostRecent, paidAmount(mostRecent.id, otherAllocMap))),
            }
          : null
      );
    }

    const allocs = (allocations ?? []) as ReceiptAllocation[];
    if (allocs.length === 0) {
      setPayments([]);
      return;
    }
    const { data: receipts, error: rcptErr } = await supabase
      .from("receipts")
      .select("*")
      .in("id", allocs.map((a) => a.receipt_id));
    if (rcptErr) {
      setError(rcptErr.message);
      return;
    }
    const receiptMap = new Map<string, Receipt>();
    for (const r of (receipts ?? []) as Receipt[]) receiptMap.set(r.id, r);
    setPayments(
      allocs.map((a) => ({
        id: a.id,
        receipt_no: receiptMap.get(a.receipt_id)?.receipt_no ?? "—",
        receipt_date: receiptMap.get(a.receipt_id)?.receipt_date ?? "",
        mode: receiptMap.get(a.receipt_id)?.mode ?? "",
        amount: a.amount,
      }))
    );
  }

  useEffect(() => {
    loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (!invoice || printedRef.current) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("print") === "1") {
      printedRef.current = true;
      setTimeout(() => window.print(), 200);
    }
  }, [invoice]);

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-4xl">
        <NotConfigured />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Couldn&apos;t load this invoice.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!invoice || !customer) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  }

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = balanceDue(invoice, paid);
  const status = displayStatus(invoice);
  const { fields: headerFields, discount, afterTaxDiscount, taxLines, notes: notesText } = parseNotes(invoice.notes);
  const discountAmount = computeDiscountAmount(invoice.subtotal, discount);
  const taxRows = computeTaxRows(invoice.subtotal - discountAmount, taxLines);
  const afterTaxDiscountAmount = computeDiscountAmount(invoice.subtotal - discountAmount + invoice.tax_amount, afterTaxDiscount);

  async function handleSendEmail() {
    if (!supabase || !invoice || !customer?.email) return;
    setEmailStatus("sending");
    setEmailError(null);

    const subject = `Invoice ${invoice.invoice_no} from ${company?.name ?? "us"}`;
    const body = [
      `Dear ${customer.contact_person || customer.name},`,
      "",
      `Please find your invoice ${invoice.invoice_no} dated ${formatDate(invoice.invoice_date)} for ${formatCurrency(invoice.total)}, due on ${formatDate(invoice.due_date)}.`,
      "",
      `Amount Paid: ${formatCurrency(paid)}`,
      `Balance Due: ${formatCurrency(balance)}`,
      "",
      "Thank you for your business.",
      "",
      "Regards,",
      company?.name ?? "",
    ].join("\n");

    const { error: logErr } = await supabase.from("reminder_log").insert({
      invoice_id: invoice.id,
      to_email: customer.email,
      subject,
      body,
      status: "sent",
    });

    if (logErr) {
      setEmailStatus("error");
      setEmailError(logErr.message);
      return;
    }
    setEmailStatus("sent");
  }

  function openPaymentForm() {
    setPaymentAmount(balance > 0 ? round2(balance) : 0);
    setPaymentDate(todayISO());
    setPaymentMode("neft");
    setPaymentReference("");
    setPaymentError(null);
    setShowPaymentForm(true);
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !invoice) return;
    if (!(paymentAmount > 0)) {
      setPaymentError("Enter an amount greater than 0.");
      return;
    }
    setPaymentSaving(true);
    setPaymentError(null);

    const { data: existing } = await supabase.from("receipts").select("receipt_no");
    let max = 0;
    for (const row of existing ?? []) {
      const m = /^RCP-(\d+)$/.exec(row.receipt_no);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const receiptNo = `RCP-${String(max + 1).padStart(4, "0")}`;

    const { data: receipt, error: receiptErr } = await supabase
      .from("receipts")
      .insert({
        receipt_no: receiptNo,
        receipt_date: paymentDate,
        customer_id: invoice.customer_id,
        amount: round2(paymentAmount),
        mode: paymentMode,
        reference: paymentReference.trim() || null,
      })
      .select("id")
      .single();
    if (receiptErr || !receipt) {
      setPaymentError(receiptErr?.message || "Couldn't save the payment.");
      setPaymentSaving(false);
      return;
    }

    const { error: allocErr } = await supabase.from("receipt_allocations").insert({
      receipt_id: receipt.id,
      invoice_id: invoice.id,
      amount: round2(paymentAmount),
    });
    if (allocErr) {
      setPaymentError(allocErr.message);
      setPaymentSaving(false);
      return;
    }

    const newPaid = round2(paid + paymentAmount);
    const newOutstanding = round2(invoice.total - newPaid);
    const newStatus = newOutstanding <= 0.005 ? "paid" : newPaid > 0 ? "partial" : invoice.status;
    if (newStatus !== invoice.status) {
      await supabase.from("invoices").update({ status: newStatus }).eq("id", invoice.id);
    }

    setPaymentSaving(false);
    setShowPaymentForm(false);
    setPaymentNotice(`Payment of ${formatCurrency(paymentAmount)} recorded (${receiptNo}).`);
    await loadInvoice();
  }

  const itemColumns: Column<InvoiceItem>[] = [
    { key: "description", header: "Description" },
    { key: "qty", header: "Qty", className: "text-right", render: (r) => String(r.qty) },
    { key: "rate", header: "Rate", className: "text-right", render: (r) => formatCurrency(r.rate) },
    { key: "amount", header: "Amount", className: "text-right", render: (r) => formatCurrency(r.amount) },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    { key: "receipt_no", header: "Receipt No" },
    { key: "receipt_date", header: "Date", render: (r) => (r.receipt_date ? formatDate(r.receipt_date) : "—") },
    { key: "mode", header: "Mode", className: "capitalize" },
    { key: "amount", header: "Amount", className: "text-right", render: (r) => formatCurrency(r.amount) },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-end justify-between gap-4 print:hidden">
        <PageHeader title={`Invoice ${invoice.invoice_no}`} subtitle={`${formatDate(invoice.invoice_date)} · due ${formatDate(invoice.due_date)}`} />
        <div className="mb-6 flex flex-none items-center gap-2">
          <StatusBadge status={status} />
          <Link
            href={`/invoices/${invoice.id}/edit`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={!customer.email || emailStatus === "sending"}
            title={!customer.email ? "This customer has no email on file" : undefined}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {emailStatus === "sending" ? "Sending…" : emailStatus === "sent" ? "Sent ✓" : "Send Email"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
          >
            Print
          </button>
          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Back
          </Link>
        </div>
      </div>

      {emailStatus === "sent" && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200 print:hidden">
          Emailed to {customer.email} — simulated send, logged to the reminder log. No real mailbox is wired up, so nothing actually left the app.
        </div>
      )}
      {emailStatus === "error" && emailError && (
        <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200 print:hidden">
          Couldn&apos;t log the email: {emailError}
        </div>
      )}
      {paymentNotice && (
        <div role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200 print:hidden">
          {paymentNotice}
        </div>
      )}

      {/* Print-only header, since the app chrome is hidden when printing */}
      <div className="mb-6 hidden items-start justify-between gap-4 border-b border-slate-200 pb-4 print:flex">
        <div>
          {company && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/verve-logo-blue.png" alt={company.name} className="mb-2 h-10 w-auto" />
              <p className="text-sm text-slate-500">{company.address}</p>
              <p className="text-sm text-slate-500">
                {company.gstin && `GSTIN ${company.gstin}`} {company.email} {company.phone}
              </p>
            </>
          )}
        </div>
        <div className="text-right">
          <h2 className="text-lg font-semibold text-slate-800">Tax Invoice</h2>
          <p className="text-sm text-slate-500">{invoice.invoice_no}</p>
          <p className="text-sm text-slate-500">{formatDate(invoice.invoice_date)}</p>
        </div>
      </div>

      <div className={`mb-4 ${PANEL}`}>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">
          Account Summary
        </h3>
        <div className={`grid grid-cols-2 gap-x-4 gap-y-1 text-sm ${BODY}`}>
          <span className={LABEL}>Last Invoice</span>
          <span>{lastInvoice ? `${lastInvoice.invoice_no} (${formatDate(lastInvoice.invoice_date)})` : "—"}</span>
          <span className={LABEL}>Last Invoice Balance</span>
          <span>{lastInvoice ? formatCurrency(lastInvoice.balance) : "—"}</span>
          <span className={LABEL}>Previous Outstanding</span>
          <span>{formatCurrency(previousOutstanding)}</span>
          <span className={LABEL}>Current Invoice Balance Due</span>
          <span className="font-medium text-slate-800 dark:text-slate-100 dark:print:text-slate-800">{formatCurrency(balance)}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        <div className={PANEL}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Billed To</h3>
          <p className="font-medium text-slate-800 dark:text-slate-100 dark:print:text-slate-800">{customer.name}</p>
          <p className={`text-sm ${BODY}`}>{customer.address}</p>
          <p className={`text-sm ${BODY}`}>{customer.gstin && `GSTIN ${customer.gstin}`}</p>
          <p className={`text-sm ${BODY}`}>
            {customer.contact_person} {customer.email && `· ${customer.email}`} {customer.phone && `· ${customer.phone}`}
          </p>
        </div>
        <div className={PANEL}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Invoice Info</h3>
          <div className={`grid grid-cols-2 gap-x-4 gap-y-1 text-sm ${BODY}`}>
            <span className={LABEL}>Invoice Date</span>
            <span>{formatDate(invoice.invoice_date)}</span>
            <span className={LABEL}>Due Date</span>
            <span>{formatDate(invoice.due_date)}</span>
            {headerFields.paymentTerms && (
              <>
                <span className={LABEL}>Payment Terms</span>
                <span>{headerFields.paymentTerms}</span>
              </>
            )}
            {headerFields.referenceNumber && (
              <>
                <span className={LABEL}>Reference Number</span>
                <span>{headerFields.referenceNumber}</span>
              </>
            )}
            {headerFields.placeOfSupply && (
              <>
                <span className={LABEL}>Place of Supply</span>
                <span>{headerFields.placeOfSupply}</span>
              </>
            )}
            {headerFields.salesperson && (
              <>
                <span className={LABEL}>Salesperson</span>
                <span>{headerFields.salesperson}</span>
              </>
            )}
            <span className={LABEL}>Status</span>
            <span className="print:hidden">
              <StatusBadge status={status} />
            </span>
            <span className="hidden print:inline">{status}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden print:break-inside-avoid">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Items</h3>
        <DataTable columns={itemColumns} rows={items} empty="No line items on this invoice." />
      </div>

      <div className="mt-4 flex justify-end print:break-inside-avoid">
        <div className={`w-full max-w-sm space-y-2 text-sm ${PANEL}`}>
          <div className={`flex justify-between ${BODY}`}>
            <span>Subtotal</span>
            <span>{formatCurrency(invoice.subtotal)}</span>
          </div>
          {discountAmount > 0 && (
            <div className={`flex justify-between ${BODY}`}>
              <span>Discount (Before Tax){discount.type === "percent" ? ` (${discount.value}%)` : ""}</span>
              <span>-{formatCurrency(discountAmount)}</span>
            </div>
          )}
          {taxRows.length > 0 ? (
            taxRows.map((row, i) => (
              <div key={i} className={`flex justify-between ${BODY}`}>
                <span>
                  {row.type} ({row.rate}%)
                </span>
                <span>{formatCurrency(row.amount)}</span>
              </div>
            ))
          ) : (
            <div className={`flex justify-between ${BODY}`}>
              <span>Tax</span>
              <span>{formatCurrency(invoice.tax_amount)}</span>
            </div>
          )}
          {afterTaxDiscountAmount > 0 && (
            <div className={`flex justify-between ${BODY}`}>
              <span>Discount (After Tax){afterTaxDiscount.type === "percent" ? ` (${afterTaxDiscount.value}%)` : ""}</span>
              <span>-{formatCurrency(afterTaxDiscountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-brand dark:border-slate-700 dark:text-brand-300 dark:print:border-slate-200 dark:print:text-brand">
            <span>Grand Total</span>
            <span>{formatCurrency(invoice.total)}</span>
          </div>
          <div className={`flex justify-between ${LABEL}`}>
            <span>Amount Paid</span>
            <span>{formatCurrency(paid)}</span>
          </div>
          <div className="flex justify-between font-medium text-slate-700 dark:text-slate-200 dark:print:text-slate-700">
            <span>Balance Due</span>
            <span>{formatCurrency(balance)}</span>
          </div>
        </div>
      </div>

      {notesText && (
        <div className={`mt-4 ${PANEL}`}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">Notes</h3>
          <p className={`text-sm ${BODY}`}>{notesText}</p>
        </div>
      )}

      <div className="mt-4 print:hidden">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment Information</h3>
          {!showPaymentForm && balance > 0.005 && (
            <button
              type="button"
              onClick={openPaymentForm}
              className="rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand-50 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-900/20"
            >
              + Record Payment
            </button>
          )}
        </div>

        {showPaymentForm && (
          <form onSubmit={handleRecordPayment} className="mb-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            {paymentError && (
              <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
                {paymentError}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Amount">
                <input
                  type="number"
                  step="0.01"
                  className={inputClass}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                />
              </FormField>
              <FormField label="Date">
                <input type="date" className={inputClass} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </FormField>
              <FormField label="Mode">
                <select className={inputClass} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as ReceiptMode)}>
                  {RECEIPT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reference">
                <input
                  className={inputClass}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Optional"
                />
              </FormField>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="submit"
                disabled={paymentSaving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:opacity-50"
              >
                {paymentSaving ? "Saving…" : "Save Payment"}
              </button>
              <button
                type="button"
                disabled={paymentSaving}
                onClick={() => setShowPaymentForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <DataTable columns={paymentColumns} rows={payments} empty="No payments recorded against this invoice yet." />
      </div>

      <div className="mt-4 print:hidden">
        <Attachments invoiceId={invoice.id} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        <div className={PANEL}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">
            Bank Details for Payment
          </h3>
          <div className={`grid grid-cols-2 gap-x-2 gap-y-1 text-xs ${BODY}`}>
            {BANK_DETAILS.map((b) => (
              <Fragment key={b.label}>
                <span className={LABEL}>{b.label}</span>
                <span>{b.value}</span>
              </Fragment>
            ))}
          </div>
        </div>
        <div className={PANEL}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 dark:print:text-slate-500">
            Terms &amp; Conditions
          </h3>
          <ol className={`list-inside list-decimal space-y-0.5 text-xs ${LABEL}`}>
            {TERMS_AND_CONDITIONS.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-10 flex justify-end print:break-inside-avoid">
        <div className={`text-center text-sm ${BODY}`}>
          <p className="font-medium">For {company?.name ?? "the Company"}</p>
          <p className="mt-12 border-t border-slate-400 pt-1 dark:border-slate-600 dark:print:border-slate-400">Authorized Signatory</p>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 print:hidden">
        Created {formatDateTime(invoice.created_at)}
        {headerFields.createdBy && ` by ${headerFields.createdBy}`}
        {headerFields.updatedBy && (
          <>
            {" "}
            · Last updated {headerFields.updatedDate ? formatDateTime(headerFields.updatedDate) : ""} by {headerFields.updatedBy}
          </>
        )}
      </p>
    </div>
  );
}
