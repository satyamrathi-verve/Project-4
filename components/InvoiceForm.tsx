"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/auth";
import type { Customer, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { FormField, inputClass } from "@/components/FormField";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DiscountInput } from "@/components/DiscountInput";
import { Attachments, attachmentsStorageKey } from "@/components/Attachments";
import { formatCurrency, formatDateTime, addDays, todayISO, round2 } from "@/lib/format";
import {
  buildAllocationMap,
  paidAmount,
  parseNotes,
  composeNotes,
  computeDiscountAmount,
  computeTaxRows,
  BLANK_HEADER_FIELDS,
  BLANK_DISCOUNT,
  TAX_TYPES,
  TERMS_AND_CONDITIONS,
  type InvoiceHeaderFields,
  type DiscountInfo,
  type TaxLine,
} from "@/lib/invoice";

interface ItemRow {
  description: string;
  qty: number;
  rate: number;
}

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const DEFAULT_TAX_LINES: TaxLine[] = [
  { type: "CGST", rate: 9 },
  { type: "SGST", rate: 9 },
];

function blankRow(): ItemRow {
  return { description: "", qty: 1, rate: 0 };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function friendlyError(message: string | undefined): string {
  if (!message) return "Something went wrong saving the invoice.";
  if (/duplicate key|unique/i.test(message)) return "That invoice number already exists — choose a different one.";
  return message;
}

/*
  Shared create/edit form. Pass invoiceId to edit an existing invoice (it loads
  the invoice + its items on mount); omit it to punch a brand-new one.
  Only fields backed by real columns on `invoices`/`invoice_items` are here —
  see lib/types.ts. Paid amount is read-only: it comes from receipt_allocations,
  never a stored column, so it can't be edited from this screen.
*/
export function InvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const isEdit = Boolean(invoiceId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [status, setStatus] = useState<InvoiceStatus>("open");
  const [headerFields, setHeaderFields] = useState<InvoiceHeaderFields>(BLANK_HEADER_FIELDS);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([blankRow()]);
  const [discount, setDiscount] = useState<DiscountInfo>(BLANK_DISCOUNT);
  const [afterTaxDiscount, setAfterTaxDiscount] = useState<DiscountInfo>(BLANK_DISCOUNT);
  const [taxLines, setTaxLines] = useState<TaxLine[]>(DEFAULT_TAX_LINES);
  const [paid, setPaid] = useState(0);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [draftId] = useState(() => `draft-${randomId()}`);
  const attachmentsKey = invoiceId ?? draftId;

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;
  const subtotal = round2(items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0));
  const discountAmount = computeDiscountAmount(subtotal, discount);
  const taxableAmount = round2(subtotal - discountAmount);
  const taxRows = computeTaxRows(taxableAmount, taxLines);
  const totalTax = round2(taxRows.reduce((sum, r) => sum + r.amount, 0));
  const preFinalTotal = round2(taxableAmount + totalTax);
  const afterTaxDiscountAmount = computeDiscountAmount(preFinalTotal, afterTaxDiscount);
  const total = round2(preFinalTotal - afterTaxDiscountAmount);
  const balanceDue = round2(total - paid);

  // Auto-fill due date from the customer's credit days, until the user edits it directly.
  useEffect(() => {
    if (dueDateTouched || !selectedCustomer || !invoiceDate) return;
    setDueDate(addDays(invoiceDate, selectedCustomer.credit_days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, invoiceDate]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data: customerData, error: custErr } = await supabase!.from("customers").select("*").order("name");
      if (custErr) {
        setLoadError(custErr.message);
        setLoading(false);
        return;
      }
      setCustomers((customerData ?? []) as Customer[]);

      if (isEdit && invoiceId) {
        const [{ data: inv, error: invErr }, { data: itemRows, error: itemErr }, { data: allocations, error: allocErr }] =
          await Promise.all([
            supabase!.from("invoices").select("*").eq("id", invoiceId).single(),
            supabase!.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("id"),
            supabase!.from("receipt_allocations").select("*").eq("invoice_id", invoiceId),
          ]);
        if (invErr || !inv) {
          setLoadError(invErr?.message || "Invoice not found.");
          setLoading(false);
          return;
        }
        if (itemErr || allocErr) {
          setLoadError(itemErr?.message || allocErr?.message || "Failed to load invoice details.");
          setLoading(false);
          return;
        }
        setCustomerId(inv.customer_id);
        setInvoiceNo(inv.invoice_no);
        setInvoiceDate(inv.invoice_date);
        setDueDate(inv.due_date);
        setDueDateTouched(true);
        setStatus(inv.status);
        setCreatedAt(inv.created_at);
        const parsedNotes = parseNotes(inv.notes);
        setHeaderFields(parsedNotes.fields);
        setNotes(parsedNotes.notes);
        setDiscount(parsedNotes.discount);
        setAfterTaxDiscount(parsedNotes.afterTaxDiscount);
        const loadedItems =
          (itemRows ?? []).length > 0
            ? (itemRows ?? []).map((it) => ({ description: it.description, qty: it.qty, rate: it.rate }))
            : [blankRow()];
        setItems(loadedItems);
        if (parsedNotes.taxLines.length > 0) {
          setTaxLines(parsedNotes.taxLines);
        } else {
          // Older invoice with no saved breakdown: back into a single rate that
          // reproduces its existing tax_amount, so the total doesn't shift on save.
          const rawSubtotal = round2(loadedItems.reduce((sum, it) => sum + it.qty * it.rate, 0));
          const discountAmt = computeDiscountAmount(rawSubtotal, parsedNotes.discount);
          const taxable = rawSubtotal - discountAmt;
          setTaxLines([{ type: "Other", rate: taxable > 0 ? round2((inv.tax_amount / taxable) * 100) : 0 }]);
        }
        const allocMap = buildAllocationMap(allocations ?? []);
        setPaid(paidAmount(invoiceId, allocMap));
      } else {
        // Suggest the next invoice number (INV-0001, INV-0002, …); still editable.
        const { data: existing } = await supabase!.from("invoices").select("invoice_no");
        let max = 0;
        for (const row of existing ?? []) {
          const m = /^INV-(\d+)$/.exec(row.invoice_no);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        }
        setInvoiceNo(`INV-${String(max + 1).padStart(4, "0")}`);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function updateHeaderField(key: keyof InvoiceHeaderFields, value: string) {
    setHeaderFields((prev) => ({ ...prev, [key]: value }));
  }

  function addRow() {
    setItems((prev) => [...prev, blankRow()]);
  }

  function removeRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTaxLine(index: number, patch: Partial<TaxLine>) {
    setTaxLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addTaxLine() {
    setTaxLines((prev) => [...prev, { type: "Other", rate: 0 }]);
  }

  function removeTaxLine(index: number) {
    setTaxLines((prev) => prev.filter((_, i) => i !== index));
  }

  function validate(): boolean {
    const errs: string[] = [];
    const bad = new Set<string>();

    if (!customerId) {
      errs.push("Select a customer.");
      bad.add("customer");
    }
    if (!invoiceNo.trim()) {
      errs.push("Enter an invoice number.");
      bad.add("invoiceNo");
    }
    if (!invoiceDate) {
      errs.push("Enter the invoice date.");
      bad.add("invoiceDate");
    }
    if (!dueDate) {
      errs.push("Enter the due date.");
      bad.add("dueDate");
    } else if (invoiceDate && dueDate < invoiceDate) {
      errs.push("Due date can't be before the invoice date.");
      bad.add("dueDate");
    }

    const realItems = items.filter((it) => it.description.trim() !== "");
    if (realItems.length === 0) {
      errs.push("Add at least one invoice item with a description.");
    }
    items.forEach((it, i) => {
      if (it.description.trim() === "") return;
      if (!(Number(it.qty) > 0)) {
        errs.push(`Item ${i + 1}: quantity must be greater than 0.`);
        bad.add(`qty-${i}`);
      }
      if (Number(it.rate) < 0) {
        errs.push(`Item ${i + 1}: price can't be negative.`);
        bad.add(`rate-${i}`);
      }
    });

    setErrors(errs);
    setInvalid(bad);
    return errs.length === 0;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSaveError(null);
    if (!validate()) return;

    setSaving(true);
    const realItems = items.filter((it) => it.description.trim() !== "");
    const currentUser = getSession() || "Unknown";
    const auditedFields: InvoiceHeaderFields = {
      ...headerFields,
      createdBy: headerFields.createdBy || currentUser,
      updatedBy: currentUser,
      updatedDate: new Date().toISOString(),
    };
    const payload = {
      invoice_no: invoiceNo.trim(),
      invoice_date: invoiceDate,
      customer_id: customerId,
      due_date: dueDate,
      subtotal,
      tax_amount: totalTax,
      total,
      status,
      notes: composeNotes(auditedFields, discount, afterTaxDiscount, taxLines, notes),
    };

    if (isEdit && invoiceId) {
      const { error: updErr } = await supabase.from("invoices").update(payload).eq("id", invoiceId);
      if (updErr) {
        setSaveError(friendlyError(updErr.message));
        setSaving(false);
        return;
      }
      const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      if (delErr) {
        setSaveError(delErr.message);
        setSaving(false);
        return;
      }
      const { error: insErr } = await supabase.from("invoice_items").insert(
        realItems.map((it) => ({
          invoice_id: invoiceId,
          description: it.description.trim(),
          qty: Number(it.qty),
          rate: Number(it.rate),
          amount: round2(Number(it.qty) * Number(it.rate)),
        }))
      );
      if (insErr) {
        setSaveError(insErr.message);
        setSaving(false);
        return;
      }
      router.push(`/invoices/${invoiceId}`);
    } else {
      const { data, error: insErr } = await supabase.from("invoices").insert(payload).select("id").single();
      if (insErr || !data) {
        setSaveError(friendlyError(insErr?.message));
        setSaving(false);
        return;
      }
      const { error: itemsErr } = await supabase.from("invoice_items").insert(
        realItems.map((it) => ({
          invoice_id: data.id,
          description: it.description.trim(),
          qty: Number(it.qty),
          rate: Number(it.rate),
          amount: round2(Number(it.qty) * Number(it.rate)),
        }))
      );
      if (itemsErr) {
        setSaveError(itemsErr.message);
        setSaving(false);
        return;
      }
      // Attachments were staged under a temporary draft key (no real id existed yet) —
      // move them over to the invoice's real id now that it has one.
      const draftAttachments = sessionStorage.getItem(attachmentsStorageKey(draftId));
      if (draftAttachments) {
        sessionStorage.setItem(attachmentsStorageKey(data.id), draftAttachments);
        sessionStorage.removeItem(attachmentsStorageKey(draftId));
      }
      router.push(`/invoices/${data.id}`);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-semibold">Couldn&apos;t load this invoice.</p>
        <p className="mt-1 text-sm">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={isEdit ? `Edit Invoice ${invoiceNo}` : "New Sales Invoice"} subtitle="Front-end only — writes through the existing Supabase tables." />

      {errors.length > 0 && (
        <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Please fix the following:</p>
          <ul className="mt-1 list-inside list-disc">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {saveError && (
        <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
          {saveError}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField label="Customer">
                <SearchableSelect
                  options={customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Search customers…"
                />
              </FormField>
              {selectedCustomer && (
                <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                  <p>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{selectedCustomer.code}</span>
                    {selectedCustomer.contact_person && ` · ${selectedCustomer.contact_person}`}
                  </p>
                  <p>
                    {selectedCustomer.email && `${selectedCustomer.email} · `}
                    {selectedCustomer.phone}
                  </p>
                  <p>
                    Credit limit {formatCurrency(selectedCustomer.credit_limit)} · {selectedCustomer.credit_days} day terms
                  </p>
                </div>
              )}
              {invalid.has("customer") && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Customer is required.</p>}
            </div>

            <FormField label="Invoice Number">
              <input
                className={inputClass}
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
            </FormField>

            <FormField label="Status">
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Invoice Date">
              <input
                type="date"
                className={inputClass}
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </FormField>

            <FormField label="Due Date">
              <input
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setDueDateTouched(true);
                }}
              />
            </FormField>

            <FormField label="Payment Terms">
              <input
                className={inputClass}
                value={headerFields.paymentTerms}
                onChange={(e) => updateHeaderField("paymentTerms", e.target.value)}
                placeholder="e.g. Net 30"
              />
            </FormField>

            <FormField label="Reference Number">
              <input
                className={inputClass}
                value={headerFields.referenceNumber}
                onChange={(e) => updateHeaderField("referenceNumber", e.target.value)}
                placeholder="e.g. PO-1234"
              />
            </FormField>

            <FormField label="Place of Supply">
              <input
                className={inputClass}
                value={headerFields.placeOfSupply}
                onChange={(e) => updateHeaderField("placeOfSupply", e.target.value)}
                placeholder="e.g. Maharashtra"
              />
            </FormField>

            <FormField label="Salesperson">
              <input
                className={inputClass}
                value={headerFields.salesperson}
                onChange={(e) => updateHeaderField("salesperson", e.target.value)}
              />
            </FormField>
          </div>

          <div className="mt-4">
            <FormField label="Notes">
              <textarea
                className={`${inputClass} min-h-20`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </FormField>
          </div>

          {isEdit && (
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
              Created {createdAt ? formatDateTime(createdAt) : "—"} by {headerFields.createdBy || "—"}
              {headerFields.updatedBy && (
                <>
                  {" "}
                  · Last updated {headerFields.updatedDate ? formatDateTime(headerFields.updatedDate) : ""} by {headerFields.updatedBy}
                </>
              )}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Invoice Items</h3>
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand-50 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-900/20"
            >
              + Add Row
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="py-2 pr-2 font-semibold text-slate-600 dark:text-slate-300">Description</th>
                  <th className="w-24 py-2 pr-2 text-right font-semibold text-slate-600 dark:text-slate-300">Qty</th>
                  <th className="w-32 py-2 pr-2 text-right font-semibold text-slate-600 dark:text-slate-300">Rate</th>
                  <th className="w-32 py-2 pr-2 text-right font-semibold text-slate-600 dark:text-slate-300">Amount</th>
                  <th className="w-10 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-2 pr-2">
                      <input
                        className={inputClass + " w-full"}
                        value={it.description}
                        onChange={(e) => updateItem(i, { description: e.target.value })}
                        placeholder="Item description"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        className={`${inputClass} w-full text-right ${invalid.has(`qty-${i}`) ? "border-red-400" : ""}`}
                        value={it.qty}
                        onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        className={`${inputClass} w-full text-right ${invalid.has(`rate-${i}`) ? "border-red-400" : ""}`}
                        value={it.rate}
                        onChange={(e) => updateItem(i, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2 text-right font-medium text-slate-700 dark:text-slate-300">
                      {formatCurrency(round2((Number(it.qty) || 0) * (Number(it.rate) || 0)))}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-red-600 hover:underline dark:text-red-400"
                        aria-label="Remove row"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tax Breakdown</h3>
            <button
              type="button"
              onClick={addTaxLine}
              className="rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand-50 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-900/20"
            >
              + Add Tax
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                  <th className="py-2 pr-2 font-semibold text-slate-600 dark:text-slate-300">Type</th>
                  <th className="w-28 py-2 pr-2 text-right font-semibold text-slate-600 dark:text-slate-300">Rate %</th>
                  <th className="w-32 py-2 pr-2 text-right font-semibold text-slate-600 dark:text-slate-300">Amount</th>
                  <th className="w-10 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {taxRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-2 pr-2">
                      <select
                        className={`${inputClass} w-full`}
                        value={row.type}
                        onChange={(e) => updateTaxLine(i, { type: e.target.value as TaxLine["type"] })}
                      >
                        {TAX_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        className={`${inputClass} w-full text-right`}
                        value={row.rate}
                        onChange={(e) => updateTaxLine(i, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2 text-right font-medium text-slate-700 dark:text-slate-300">{formatCurrency(row.amount)}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeTaxLine(i)}
                        className="text-red-600 hover:underline dark:text-red-400"
                        aria-label="Remove tax line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-4 flex max-w-sm flex-col gap-2 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
              <span>Discount (Before Tax)</span>
              <DiscountInput value={discount} onChange={setDiscount} />
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>Discount applied</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600 dark:text-slate-300">
              <span>Tax</span>
              <span>{formatCurrency(totalTax)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
              <span>Discount (After Tax)</span>
              <DiscountInput value={afterTaxDiscount} onChange={setAfterTaxDiscount} />
            </div>
            {afterTaxDiscountAmount > 0 && (
              <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>Discount applied</span>
                <span>-{formatCurrency(afterTaxDiscountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-brand dark:border-slate-700 dark:text-brand-300">
              <span>Grand Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
            {isEdit && (
              <>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Amount Paid</span>
                  <span>{formatCurrency(paid)}</span>
                </div>
                <div className="flex justify-between font-medium text-slate-700 dark:text-slate-200">
                  <span>Balance Due</span>
                  <span>{formatCurrency(balanceDue)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Invoice"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => router.push("/invoices")}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="mt-6">
        <Attachments invoiceId={attachmentsKey} />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Terms &amp; Conditions</h3>
        <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
          Standard terms shown on every invoice — for reference here, not editable per-invoice.
        </p>
        <ol className="list-inside list-decimal space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          {TERMS_AND_CONDITIONS.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
