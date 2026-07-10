"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { Customer, Invoice, ReceiptAllocation, ReminderTemplate, ReminderLog } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { IconButton, ActionIcons } from "@/components/IconButton";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { ScreenIcon } from "@/components/icons";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { buildAllocationMap, paidAmount, balanceDue } from "@/lib/invoice";
import { effectiveStatus, daysOverdue } from "@/components/StatusPill";

const MERGE_FIELDS = [
  { key: "{customer}", desc: "customer name" },
  { key: "{amount}", desc: "outstanding amount" },
  { key: "{days_overdue}", desc: "days past due" },
  { key: "{invoice_no}", desc: "invoice number" },
];

const SAMPLE_VARS: Record<string, string> = {
  customer: "Sterling Textiles Pvt Ltd",
  amount: "45,000.00",
  days_overdue: "23",
  invoice_no: "INV-1042",
};

function fillTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

const EMPTY_TEMPLATE_FORM = { id: "", name: "", subject: "", body: "" };

interface OverdueRow {
  id: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  dueDate: string;
  daysOverdue: number;
  balance: number;
}

function daysOverdueClass(days: number) {
  if (days > 60) return "text-red-600 dark:text-red-400 font-semibold";
  if (days > 30) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-slate-600 dark:text-slate-300";
}

function KpiTile({ icon, label, value, tone = "default" }: { icon: string; label: string; value: string | number; tone?: "default" | "warn" }) {
  const iconWrap =
    tone === "warn"
      ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"
      : "bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand-300";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-lg ${iconWrap}`}>
          <ScreenIcon name={icon} className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const [tab, setTab] = useState<"templates" | "shoot">("templates");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [log, setLog] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [
      { data: cust, error: custErr },
      { data: inv, error: invErr },
      { data: alloc, error: allocErr },
      { data: tmpl, error: tmplErr },
      { data: logs, error: logErr },
    ] = await Promise.all([
      supabase.from("customers").select("*"),
      supabase.from("invoices").select("*"),
      supabase.from("receipt_allocations").select("*"),
      supabase.from("reminder_templates").select("*").order("name"),
      supabase.from("reminder_log").select("*").order("sent_at", { ascending: false }).limit(50),
    ]);

    const err = custErr || invErr || allocErr || tmplErr || logErr;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setCustomers((cust as Customer[]) ?? []);
    setInvoices((inv as Invoice[]) ?? []);
    setAllocations((alloc as ReceiptAllocation[]) ?? []);
    // Hide recurring-invoice profiles (stored in this table under a marker
    // prefix, managed from Sales Invoices → Recurring) from the template list.
    setTemplates(((tmpl as ReminderTemplate[]) ?? []).filter((t) => !t.name.startsWith("[recurring]")));
    setLog((logs as ReminderLog[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const invoiceMap = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const i of invoices) m.set(i.id, i);
    return m;
  }, [invoices]);

  const overdueRows = useMemo<OverdueRow[]>(() => {
    const allocMap = buildAllocationMap(allocations);
    const rows: OverdueRow[] = [];
    for (const inv of invoices) {
      if (effectiveStatus(inv.status, inv.due_date) !== "overdue") continue;
      const paid = paidAmount(inv.id, allocMap);
      const balance = balanceDue(inv, paid);
      if (balance <= 0) continue;
      const customer = customerMap.get(inv.customer_id);
      rows.push({
        id: inv.id,
        invoiceNo: inv.invoice_no,
        customerId: inv.customer_id,
        customerName: customer?.name ?? "Unknown customer",
        customerEmail: customer?.email ?? null,
        dueDate: inv.due_date,
        daysOverdue: daysOverdue(inv.due_date),
        balance,
      });
    }
    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return rows;
  }, [invoices, allocations, customerMap]);

  const selectableRows = useMemo(() => overdueRows.filter((r) => r.customerEmail), [overdueRows]);

  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) setSelectedTemplateId(templates[0].id);
  }, [templates, selectedTemplateId]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const totalOverdueAmount = useMemo(() => overdueRows.reduce((sum, r) => sum + r.balance, 0), [overdueRows]);
  const customersAffected = useMemo(() => new Set(overdueRows.map((r) => r.customerId)).size, [overdueRows]);

  function resetTemplateForm() {
    setTemplateForm(EMPTY_TEMPLATE_FORM);
    setEditingTemplate(false);
  }

  function startEditTemplate(t: ReminderTemplate) {
    setTemplateForm({ id: t.id, name: t.name, subject: t.subject, body: t.body });
    setEditingTemplate(true);
  }

  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSavingTemplate(true);
    setError(null);

    const payload = { name: templateForm.name, subject: templateForm.subject, body: templateForm.body };
    const resp =
      editingTemplate && templateForm.id
        ? await supabase.from("reminder_templates").update(payload).eq("id", templateForm.id).select().single()
        : await supabase.from("reminder_templates").insert(payload).select().single();

    if (resp.error) {
      setError(resp.error.message);
      setSavingTemplate(false);
      return;
    }
    resetTemplateForm();
    await load();
    setSavingTemplate(false);
  }

  async function handleDeleteTemplate(id: string) {
    if (!supabase) return;
    if (!confirm("Delete this template? This can't be undone.")) return;
    const { error: delErr } = await supabase.from("reminder_templates").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    if (templateForm.id === id) resetTemplateForm();
    await load();
  }

  function toggleInvoice(id: string) {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedInvoiceIds((prev) =>
      prev.size === selectableRows.length ? new Set() : new Set(selectableRows.map((r) => r.id))
    );
  }

  async function handleSendReminders() {
    if (!supabase || !selectedTemplate || selectedInvoiceIds.size === 0) return;
    setSending(true);
    setSendNotice(null);
    setError(null);

    const targets = selectableRows.filter((r) => selectedInvoiceIds.has(r.id));
    const inserts = targets.map((r) => {
      const vars = {
        customer: r.customerName,
        amount: formatCurrency(r.balance).replace("₹", ""),
        days_overdue: String(r.daysOverdue),
        invoice_no: r.invoiceNo,
      };
      return {
        invoice_id: r.id,
        to_email: r.customerEmail,
        subject: fillTemplate(selectedTemplate.subject, vars),
        body: fillTemplate(selectedTemplate.body, vars),
        status: "sent",
      };
    });

    const { error: sendErr } = await supabase.from("reminder_log").insert(inserts);
    if (sendErr) {
      setError(sendErr.message);
      setSending(false);
      return;
    }

    const uniqueCustomers = new Set(targets.map((t) => t.customerId)).size;
    setSendNotice(
      `Sent ${targets.length} reminder${targets.length === 1 ? "" : "s"} to ${uniqueCustomers} customer${uniqueCustomers === 1 ? "" : "s"}.`
    );
    setSelectedInvoiceIds(new Set());
    await load();
    setSending(false);
  }

  const logColumns: Column<ReminderLog>[] = [
    { key: "sent_at", header: "Sent", render: (r) => formatDateTime(r.sent_at) },
    { key: "invoice_id", header: "Invoice", render: (r) => (r.invoice_id ? invoiceMap.get(r.invoice_id)?.invoice_no ?? "—" : "—") },
    { key: "to_email", header: "To", render: (r) => r.to_email ?? "—" },
    { key: "subject", header: "Subject", render: (r) => <span className="line-clamp-1">{r.subject ?? "—"}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {r.status}
        </span>
      ),
    },
  ];

  const templateColumns: Column<ReminderTemplate>[] = [
    { key: "name", header: "Name" },
    { key: "subject", header: "Subject", render: (t) => <span className="line-clamp-1">{t.subject}</span> },
    {
      key: "id",
      header: "Action",
      render: (t) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton label="Edit template" shape="ghost" onClick={() => startEditTemplate(t)}>
            {ActionIcons.edit}
          </IconButton>
          <IconButton label="Delete template" shape="ghost" variant="danger" onClick={() => handleDeleteTemplate(t.id)}>
            {ActionIcons.delete}
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="AR Followup"
        subtitle="Manage reminder templates, then chase every overdue invoice in one click."
      />

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={() => setTab("templates")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
            tab === "templates" ? "bg-brand text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setTab("shoot")}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
            tab === "shoot" ? "bg-brand text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          Auto Email Shoot
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : tab === "templates" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Templates</h3>
            <div className="mt-4">
              <DataTable columns={templateColumns} rows={templates} empty="No templates yet — create one to get started." />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {editingTemplate ? "Edit template" : "New template"}
              </h3>
              {editingTemplate && (
                <button type="button" onClick={resetTemplateForm} className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  Cancel edit
                </button>
              )}
            </div>

            <form onSubmit={handleSaveTemplate} className="mt-4 flex flex-col gap-4">
              <FormField label="Template name">
                <input
                  required
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                  className={inputClass}
                  placeholder="First reminder"
                />
              </FormField>

              <FormField label="Subject">
                <input
                  required
                  value={templateForm.subject}
                  onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                  className={inputClass}
                  placeholder="Payment reminder for invoice {invoice_no}"
                />
              </FormField>

              <FormField label="Body">
                <textarea
                  required
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })}
                  className={`${inputClass} min-h-40`}
                  placeholder={`Dear {customer},\n\nOur records show invoice {invoice_no} is {days_overdue} days overdue for ₹{amount}. Please arrange payment at the earliest.\n\nRegards`}
                />
              </FormField>

              <div className="flex flex-wrap gap-1.5">
                {MERGE_FIELDS.map((f) => (
                  <span
                    key={f.key}
                    title={f.desc}
                    className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand dark:bg-brand-900/30 dark:text-brand-300"
                  >
                    {f.key}
                  </span>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {savingTemplate ? "Saving…" : editingTemplate ? "Save changes" : "Create template"}
                </button>
              </div>
            </form>

            {(templateForm.subject || templateForm.body) && (
              <div className="mt-5 rounded-lg border border-dashed border-brand/40 bg-brand-50/40 p-4 dark:border-brand-400/30 dark:bg-brand-900/10">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-300">
                  Preview with sample data
                </p>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {fillTemplate(templateForm.subject, SAMPLE_VARS)}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                  {fillTemplate(templateForm.body, SAMPLE_VARS)}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <KpiTile icon="ageing" label="Overdue Invoices" value={overdueRows.length} tone={overdueRows.length > 0 ? "warn" : "default"} />
            <KpiTile icon="customers" label="Customers Affected" value={customersAffected} />
            <KpiTile icon="cashflow" label="Total Overdue Amount" value={formatCurrency(totalOverdueAmount)} />
          </div>

          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="w-full max-w-xs">
                <FormField label="Template to send">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="" disabled>
                      Choose a template…
                    </option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <button
                onClick={handleSendReminders}
                disabled={sending || !selectedTemplate || selectedInvoiceIds.size === 0}
                className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? "Sending…" : `Send Reminders (${selectedInvoiceIds.size})`}
              </button>
            </div>

            {templates.length === 0 && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
                No templates yet —{" "}
                <button onClick={() => setTab("templates")} className="font-medium underline underline-offset-2">
                  create one first
                </button>
                .
              </p>
            )}

            {sendNotice && (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {sendNotice}
              </p>
            )}

            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectableRows.length > 0 && selectedInvoiceIds.size === selectableRows.length}
                        onChange={toggleAll}
                        disabled={selectableRows.length === 0}
                        aria-label="Select all overdue invoices"
                      />
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Invoice</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Days Overdue</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Outstanding</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600 dark:text-slate-300">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                        No overdue invoices right now — nothing to chase.
                      </td>
                    </tr>
                  ) : (
                    overdueRows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedInvoiceIds.has(r.id)}
                            onChange={() => toggleInvoice(r.id)}
                            disabled={!r.customerEmail}
                            aria-label={`Select invoice ${r.invoiceNo}`}
                          />
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.customerName}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.invoiceNo}</td>
                        <td className={`px-4 py-3 ${daysOverdueClass(r.daysOverdue)}`}>{r.daysOverdue}d</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{formatCurrency(r.balance)}</td>
                        <td className="px-4 py-3">
                          {r.customerEmail ? (
                            <span className="text-slate-700 dark:text-slate-300">{r.customerEmail}</span>
                          ) : (
                            <span className="text-xs text-amber-600 dark:text-amber-400">No email on file</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Recent reminders sent
            </h3>
            <div className="mt-4">
              <DataTable columns={logColumns} rows={log} empty="No reminders sent yet." />
            </div>
          </div>
        </>
      )}
    </>
  );
}
