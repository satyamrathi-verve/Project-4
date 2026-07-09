"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Company, Customer, Invoice, InvoiceItem, Receipt, ReceiptAllocation, ReceiptMode } from "@/lib/types";
import { NotConfigured } from "@/components/NotConfigured";
import { StatusBadge } from "@/components/StatusBadge";
import { IconButton, IconLink, ActionIcons } from "@/components/IconButton";
import { Attachments } from "@/components/Attachments";
import { VerveLogo } from "@/components/VerveLogo";
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

// Placeholder company bank details — same on every invoice, so no schema for it either.
// There's no real bank data anywhere in the backend, so these are examples: replace
// with the company's actual account details before this is used for a real invoice.
const BANK_DETAILS: { label: string; value: string; word?: boolean }[] = [
  { label: "Mode of Payment", value: "Bank Transfer / NEFT / RTGS / UPI", word: true },
  { label: "Bank Name", value: "HDFC Bank", word: true },
  { label: "Account No.", value: "50200012345678" },
  { label: "Account Type", value: "Current Account", word: true },
  { label: "IFSC Code", value: "HDFC0001234" },
  { label: "MICR No.", value: "411240002" },
];

/*
  Design tokens for the invoice document itself (the part that prints), scoped
  under .invoice-doc so it never leaks into the rest of the app's UI. Values
  are pinned back to the light set under print, regardless of the screen's
  dark-mode toggle — paper is white either way.
*/
const DOC_STYLE = `
  .invoice-doc {
    --paper: #fbfbfa; --ink: #1c2333; --muted: #5b6478; --line: #d8dce6;
    --brand: #23408b; --brand-deep: #0d1b3f; --brand-tint: #eef2fa; --accent: #fe7a15;
    --face-display: "Segoe UI Semibold", "Century Gothic", "Trebuchet MS", sans-serif;
    --face-body: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    --face-mono: var(--face-body);
    background: var(--paper); color: var(--ink); border: 1px solid var(--line);
  }
  .dark .invoice-doc {
    --paper: #14181f; --ink: #e7e9ee; --muted: #96a0b5; --line: #2b3241;
    --brand: #6f8fd6; --brand-deep: #0a1730; --brand-tint: #1a2338; --accent: #ff9640;
  }
  @media print {
    .invoice-doc, .dark .invoice-doc {
      --paper: #fbfbfa; --ink: #1c2333; --muted: #5b6478; --line: #d8dce6;
      --brand: #23408b; --brand-deep: #0d1b3f; --brand-tint: #eef2fa; --accent: #fe7a15;
    }
    .invoice-doc { border: none !important; box-shadow: none !important; margin: 0 !important; width: 100% !important; }
    .invoice-doc, .invoice-doc * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .invoice-doc .doc-header { flex-direction: row !important; }
    .invoice-doc .doc-header,
    .invoice-doc .doc-summary,
    .invoice-doc table.doc-items,
    .invoice-doc .doc-totals-wrap,
    .invoice-doc .doc-lower,
    .invoice-doc .doc-sign-row { break-inside: avoid; }
    .invoice-doc table.doc-items tr,
    .invoice-doc .doc-term-row { break-inside: avoid; }
  }
  .invoice-doc .doc-header { background: var(--brand-deep); color: #fff; padding: 34px 40px 28px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .invoice-doc .doc-header-company { margin-top: 14px; font-size: 12.5px; line-height: 1.55; color: #c3cde6; max-width: 300px; }
  .invoice-doc .doc-type { font-family: var(--face-display); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .invoice-doc .doc-number { margin-top: 6px; font-family: var(--face-mono); font-size: 22px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .invoice-doc .doc-dates { margin-top: 10px; font-size: 12px; color: #c3cde6; font-family: var(--face-mono); font-variant-numeric: tabular-nums; line-height: 1.7; }
  .invoice-doc .doc-dates b { color: #fff; font-weight: 600; }
  .invoice-doc .doc-rule { height: 3px; background: var(--accent); }
  .invoice-doc .doc-summary { background: var(--brand-tint); border-bottom: 1px solid var(--line); padding: 20px 40px; }
  .invoice-doc .doc-summary-cell + .doc-summary-cell { margin-top: 14px; }
  .invoice-doc .doc-summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
  .invoice-doc .doc-summary-value { margin-top: 4px; font-family: var(--face-mono); font-size: 14px; font-variant-numeric: tabular-nums; color: var(--brand); font-weight: 600; }
  .invoice-doc .doc-body { padding: 30px 40px 8px; }
  .invoice-doc .doc-block-label { font-family: var(--face-display); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 8px; }
  .invoice-doc .doc-bill-name { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 3px; }
  .invoice-doc .doc-bill-line { font-size: 12.5px; color: var(--muted); line-height: 1.6; margin: 0; }
  .invoice-doc .doc-info-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 14px; row-gap: 5px; font-size: 12.5px; }
  .invoice-doc .doc-info-grid dt { color: var(--muted); }
  .invoice-doc .doc-info-grid dd { margin: 0; font-family: var(--face-mono); font-variant-numeric: tabular-nums; }
  .invoice-doc .doc-word { font-family: var(--face-body) !important; }
  .invoice-doc hr.doc-div { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
  .invoice-doc table.doc-items { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .invoice-doc table.doc-items th { text-align: left; font-family: var(--face-display); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 0 0 8px; border-bottom: 2px solid var(--brand); }
  .invoice-doc table.doc-items th.num, .invoice-doc table.doc-items td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .invoice-doc table.doc-items td { padding: 11px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  .invoice-doc table.doc-items td.mono { font-family: var(--face-mono); }
  .invoice-doc .doc-totals-wrap { display: flex; justify-content: flex-end; margin: 22px 0 4px; }
  .invoice-doc .doc-totals { width: 300px; font-size: 13px; }
  .invoice-doc .doc-totals .row { display: flex; justify-content: space-between; padding: 6px 0; color: var(--muted); }
  .invoice-doc .doc-totals .row .amt { font-family: var(--face-mono); font-variant-numeric: tabular-nums; }
  .invoice-doc .doc-totals .row.discount .amt { color: var(--accent); }
  .invoice-doc .doc-totals-grand { margin-top: 10px; background: var(--brand); color: #fff; padding: 13px 16px; display: flex; justify-content: space-between; align-items: baseline; }
  .invoice-doc .doc-totals-grand .lbl { font-family: var(--face-display); font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .invoice-doc .doc-totals-grand .amt { font-family: var(--face-mono); font-size: 19px; font-variant-numeric: tabular-nums; font-weight: 600; }
  .invoice-doc .doc-balance-due { margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; color: var(--ink); }
  .invoice-doc .doc-balance-due .amt { font-family: var(--face-mono); font-variant-numeric: tabular-nums; color: var(--accent); }
  .invoice-doc .doc-lower { padding: 30px 40px 0; }
  .invoice-doc .doc-col + .doc-col { border-left: 1px solid var(--line); padding-left: 28px; }
  .invoice-doc .doc-terms { font-size: 11.5px; color: var(--muted); }
  .invoice-doc .doc-term-row { display: flex; gap: 8px; margin-bottom: 7px; }
  .invoice-doc .doc-term-row:last-child { margin-bottom: 0; }
  .invoice-doc .doc-term-num { flex: none; min-width: 15px; font-weight: 700; color: var(--brand); }
  .invoice-doc .doc-term-text { line-height: 1.6; }
  .invoice-doc dl.doc-bank { margin: 0; display: grid; grid-template-columns: auto 1fr; row-gap: 6px; column-gap: 12px; font-size: 12px; }
  .invoice-doc dl.doc-bank dt { color: var(--muted); }
  .invoice-doc dl.doc-bank dd { margin: 0; font-family: var(--face-mono); font-variant-numeric: tabular-nums; }
  .invoice-doc .doc-sign-row { display: flex; justify-content: flex-end; padding: 40px 40px 0; }
  .invoice-doc .doc-sign-block { text-align: center; font-size: 12.5px; color: var(--muted); }
  .invoice-doc .doc-sign-block .for { font-weight: 600; margin-bottom: 46px; color: var(--ink); }
  .invoice-doc .doc-sign-block .line { border-top: 1px solid var(--ink); padding-top: 6px; }
  .invoice-doc .doc-footer { margin-top: 34px; padding: 18px 40px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--muted); display: flex; justify-content: space-between; }
  @media (max-width: 640px) {
    .invoice-doc .doc-header { flex-direction: column; }
    .invoice-doc .doc-body, .invoice-doc .doc-lower { padding-left: 20px; padding-right: 20px; }
    .invoice-doc .doc-header { padding-left: 20px; padding-right: 20px; }
    .invoice-doc .doc-footer { padding-left: 20px; padding-right: 20px; flex-direction: column; gap: 4px; }
    .invoice-doc .doc-col + .doc-col { border-left: none; padding-left: 0; margin-top: 24px; }
  }
`;

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

  // Payment timeline derivations: payments oldest-first, plus due/overdue state
  // (due date compared against today at local midnight).
  const timelinePayments = [...payments].sort((a, b) => (a.receipt_date < b.receipt_date ? -1 : a.receipt_date > b.receipt_date ? 1 : 0));
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const dueMidnight = new Date(`${invoice.due_date}T00:00:00`);
  const isSettled = balance <= 0.005;
  const isOverdue = !isSettled && dueMidnight.getTime() < todayMidnight.getTime();
  const overdueDays = Math.round((todayMidnight.getTime() - dueMidnight.getTime()) / 86400000);
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

  return (
    <div className="mx-auto max-w-4xl print:max-w-none">
      <style>{DOC_STYLE}</style>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 print:hidden">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-brand dark:text-white">Invoice {invoice.invoice_no}</h2>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Issued {formatDate(invoice.invoice_date)} · Due {formatDate(invoice.due_date)} · {customer.name}
          </p>
        </div>
        <div className="flex flex-none items-center gap-5">
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Balance Due</p>
            <p className={`text-xl font-bold tabular-nums ${balance > 0.005 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {formatCurrency(balance)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <IconLink label="Back to invoices" href="/invoices">
              {ActionIcons.back}
            </IconLink>
            <IconLink label="Edit invoice" href={`/invoices/${invoice.id}/edit`}>
              {ActionIcons.edit}
            </IconLink>
            <IconButton
              label={
                !customer.email
                  ? "This customer has no email on file"
                  : emailStatus === "sending"
                  ? "Sending…"
                  : emailStatus === "sent"
                  ? "Email sent"
                  : "Send email"
              }
              onClick={handleSendEmail}
              disabled={!customer.email || emailStatus === "sending"}
            >
              {emailStatus === "sending" ? ActionIcons.spinner : emailStatus === "sent" ? ActionIcons.check : ActionIcons.mail}
            </IconButton>
            <IconButton label="Print / Save as PDF" variant="primary" onClick={() => window.print()}>
              {ActionIcons.print}
            </IconButton>
          </div>
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

      {/* The invoice document itself — this is what prints. */}
      <div className="invoice-doc mb-6 print:m-0 print:border-none">
        <div className="doc-header">
          <div>
            <VerveLogo variant="reversed" className="text-[25px]" />
            {company && (
              <p className="doc-header-company">
                {company.address}
                <br />
                GSTIN {company.gstin} &nbsp;·&nbsp; {company.email}
                <br />
                {company.phone}
              </p>
            )}
          </div>
          <div className="flex-none text-right">
            <div className="doc-type">Tax Invoice</div>
            <div className="doc-number">{invoice.invoice_no}</div>
            <div className="doc-dates">
              Invoice date &nbsp;<b>{formatDate(invoice.invoice_date)}</b>
              <br />
              Due date &nbsp;<b>{formatDate(invoice.due_date)}</b>
            </div>
          </div>
        </div>
        <div className="doc-rule" />

        <div className="doc-summary">
          <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div className="doc-col">
              <div className="doc-summary-cell">
                <div className="doc-summary-label">Last Invoice</div>
                <div className="doc-summary-value">{lastInvoice ? `${lastInvoice.invoice_no} (${formatDate(lastInvoice.invoice_date)})` : "—"}</div>
              </div>
              <div className="doc-summary-cell">
                <div className="doc-summary-label">Last Invoice Balance</div>
                <div className="doc-summary-value">{lastInvoice ? formatCurrency(lastInvoice.balance) : "—"}</div>
              </div>
            </div>
            <div className="doc-col">
              <div className="doc-summary-cell">
                <div className="doc-summary-label">Previous Outstanding</div>
                <div className="doc-summary-value">{formatCurrency(previousOutstanding)}</div>
              </div>
              <div className="doc-summary-cell">
                <div className="doc-summary-label">Current Balance Due</div>
                <div className="doc-summary-value">{formatCurrency(balance)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="doc-body">
          <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div className="doc-col">
              <p className="doc-block-label">Billed To</p>
              <p className="doc-bill-name">{customer.name}</p>
              <p className="doc-bill-line">{customer.address}</p>
              <p className="doc-bill-line">{customer.gstin && `GSTIN ${customer.gstin}`}</p>
              <p className="doc-bill-line">
                {customer.contact_person} {customer.email && `· ${customer.email}`} {customer.phone && `· ${customer.phone}`}
              </p>
            </div>
            <div className="doc-col">
              <p className="doc-block-label">Invoice Info</p>
              <dl className="doc-info-grid">
                <dt>Invoice Date</dt>
                <dd>{formatDate(invoice.invoice_date)}</dd>
                <dt>Due Date</dt>
                <dd>{formatDate(invoice.due_date)}</dd>
                {headerFields.paymentTerms && (
                  <>
                    <dt>Payment Terms</dt>
                    <dd className="doc-word">{headerFields.paymentTerms}</dd>
                  </>
                )}
                {headerFields.referenceNumber && (
                  <>
                    <dt>Reference No.</dt>
                    <dd>{headerFields.referenceNumber}</dd>
                  </>
                )}
                {headerFields.placeOfSupply && (
                  <>
                    <dt>Place of Supply</dt>
                    <dd>{headerFields.placeOfSupply}</dd>
                  </>
                )}
                {headerFields.salesperson && (
                  <>
                    <dt>Salesperson</dt>
                    <dd className="doc-word">{headerFields.salesperson}</dd>
                  </>
                )}
                <dt>Status</dt>
                <dd className="print:hidden">
                  <StatusBadge status={status} />
                </dd>
                <dd className="hidden print:block">{status}</dd>
              </dl>
            </div>
          </div>

          <hr className="doc-div" />

          <p className="doc-block-label">Items</p>
          <table className="doc-items">
            <thead>
              <tr>
                <th style={{ width: "46%" }}>Description</th>
                <th className="num" style={{ width: "10%" }}>Qty</th>
                <th className="num" style={{ width: "18%" }}>Rate</th>
                <th className="num" style={{ width: "22%" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0" }}>
                    No line items on this invoice.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="num mono">{it.qty}</td>
                    <td className="num mono">{formatCurrency(it.rate)}</td>
                    <td className="num mono">{formatCurrency(it.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="doc-totals-wrap">
            <div className="doc-totals">
              <div className="row">
                <span>Subtotal</span>
                <span className="amt">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="row discount">
                  <span>Discount (Before Tax){discount.type === "percent" ? ` (${discount.value}%)` : ""}</span>
                  <span className="amt">-{formatCurrency(discountAmount)}</span>
                </div>
              )}
              {taxRows.length > 0 ? (
                taxRows.map((row, i) => (
                  <div key={i} className="row">
                    <span>
                      {row.type} ({row.rate}%)
                    </span>
                    <span className="amt">{formatCurrency(row.amount)}</span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <span>Tax</span>
                  <span className="amt">{formatCurrency(invoice.tax_amount)}</span>
                </div>
              )}
              {afterTaxDiscountAmount > 0 && (
                <div className="row discount">
                  <span>Discount (After Tax){afterTaxDiscount.type === "percent" ? ` (${afterTaxDiscount.value}%)` : ""}</span>
                  <span className="amt">-{formatCurrency(afterTaxDiscountAmount)}</span>
                </div>
              )}
              <div className="doc-totals-grand">
                <span className="lbl">Grand Total</span>
                <span className="amt">{formatCurrency(invoice.total)}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span>Amount Paid</span>
                <span className="amt">{formatCurrency(paid)}</span>
              </div>
              <div className="doc-balance-due">
                <span>Balance Due</span>
                <span className="amt">{formatCurrency(balance)}</span>
              </div>
            </div>
          </div>

          {notesText && (
            <>
              <hr className="doc-div" style={{ marginBottom: 16 }} />
              <p className="doc-block-label">Notes</p>
              <p style={{ fontSize: 12.5, color: "var(--muted)" }}>{notesText}</p>
            </>
          )}
        </div>

        <div className="doc-lower">
          <hr className="doc-div" style={{ marginTop: 0 }} />
          <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
            <div className="doc-col">
              <p className="doc-block-label">Bank Details for Payment</p>
              <dl className="doc-bank">
                {BANK_DETAILS.map((b) => (
                  <Fragment key={b.label}>
                    <dt>{b.label}</dt>
                    <dd className={b.word ? "doc-word" : undefined}>{b.value}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
            <div className="doc-col">
              <p className="doc-block-label">Terms &amp; Conditions</p>
              <div className="doc-terms">
                {TERMS_AND_CONDITIONS.map((t, i) => (
                  <div key={i} className="doc-term-row">
                    <span className="doc-term-num">{i + 1}.</span>
                    <span className="doc-term-text">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="doc-sign-row">
          <div className="doc-sign-block">
            <p className="for">For {company?.name ?? "the Company"}</p>
            <p className="line">Authorized Signatory</p>
          </div>
        </div>

        <div className="doc-footer">
          <span>
            {company?.name} · GSTIN {company?.gstin}
          </span>
          <span>Generated by AR Manager</span>
        </div>
      </div>

      <div className="print:hidden">
        <div className="mb-4 flex items-center justify-between">
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

        <div className="ml-3 border-l-2 border-slate-200 pl-6 dark:border-slate-800">
          <div className="relative flex flex-col gap-0.5 pb-5">
            <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-brand dark:border-slate-900" aria-hidden="true" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Invoice raised</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatDate(invoice.invoice_date)} · {formatCurrency(invoice.total)}
            </p>
          </div>

          {timelinePayments.map((p) => (
            <div key={p.id} className="relative flex flex-col gap-0.5 pb-5">
              <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" aria-hidden="true" />
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">+{formatCurrency(p.amount)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {p.receipt_no} · {p.mode.toUpperCase()} · {formatDate(p.receipt_date)}
              </p>
            </div>
          ))}

          {isSettled ? (
            <div className="relative flex flex-col gap-0.5 pb-1">
              <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" aria-hidden="true" />
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Fully settled</p>
            </div>
          ) : isOverdue ? (
            <div className="relative flex flex-col gap-0.5 pb-1">
              <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-red-500 dark:border-slate-900" aria-hidden="true" />
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                Overdue by {overdueDays} {overdueDays === 1 ? "day" : "days"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                was due {formatDate(invoice.due_date)} · balance {formatCurrency(balance)}
              </p>
            </div>
          ) : (
            <div className="relative flex flex-col gap-0.5 pb-1">
              <span className="absolute -left-[33px] top-0.5 h-4 w-4 rounded-full border-2 border-white bg-amber-500 dark:border-slate-900" aria-hidden="true" />
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Due {formatDate(invoice.due_date)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">balance {formatCurrency(balance)}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-6 dark:border-slate-800 print:hidden">
        <Attachments invoiceId={invoice.id} />
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
