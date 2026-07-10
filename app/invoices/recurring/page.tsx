"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { inr, formatShortDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import { IconButton, IconLink, ActionIcons } from "@/components/IconButton";
import { toast } from "@/components/Toast";
import {
  type RecurringProfile,
  type RecurringItem,
  loadProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  runDueRecurring,
  profileSubtotal,
  profileTotal,
  round2,
} from "@/lib/recurring";

/*
  Recurring Invoices: schedule an invoice to raise itself every week or month.
  Pick the customer, the first invoice date, the line items and tax — from then
  on the app generates the invoice automatically whenever it's due (checked on
  every app load), with due dates from the customer's credit days.
*/

interface CustomerOpt {
  id: string;
  name: string;
  credit_days: number;
}

const BLANK_ITEM: RecurringItem = { description: "", qty: 1, rate: 0 };

export default function RecurringInvoicesPage() {
  const [profiles, setProfiles] = useState<RecurringProfile[] | null>(null);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // form state
  const [customerId, setCustomerId] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "weekly">("monthly");
  const [startDate, setStartDate] = useState(todayISO());
  const [taxPct, setTaxPct] = useState(18);
  const [items, setItems] = useState<RecurringItem[]>([{ ...BLANK_ITEM }]);

  async function reload() {
    setProfiles(await loadProfiles());
  }

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      // Generate anything already due, then show the list.
      const generated = await runDueRecurring();
      for (const g of generated) toast(`Recurring: ${g.invoice_no} raised for ${g.customerName} (${inr.format(g.total)})`);
      const { data } = await supabase!.from("customers").select("id, name, credit_days").order("name");
      setCustomers((data ?? []).map((c) => ({ ...c, credit_days: Number(c.credit_days) || 30 })));
      await reload();
    })();
  }, []);

  const subtotal = useMemo(() => profileSubtotal(items), [items]);
  const total = useMemo(() => profileTotal({ items, taxPct }), [items, taxPct]);

  function setItem(idx: number, patch: Partial<RecurringItem>) {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    setFormError(null);
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return setFormError("Pick a customer.");
    if (!startDate) return setFormError("Pick the first invoice date.");
    const cleanItems = items.filter((it) => it.description.trim() && it.qty > 0 && it.rate > 0);
    if (cleanItems.length === 0) return setFormError("Add at least one line item with a description, quantity and rate.");

    setSaving(true);
    const id = await createProfile({
      customerId: cust.id,
      customerName: cust.name,
      items: cleanItems.map((it) => ({ description: it.description.trim(), qty: round2(it.qty), rate: round2(it.rate) })),
      taxPct: round2(taxPct),
      frequency,
      anchorDay: Number(startDate.split("-")[2]),
      nextRun: startDate,
      active: true,
      createdAt: todayISO(),
    });
    setSaving(false);

    if (!id) return setFormError("Couldn't save the schedule — check the connection and try again.");

    toast(`Recurring schedule created for ${cust.name}`);
    setShowForm(false);
    setCustomerId("");
    setItems([{ ...BLANK_ITEM }]);
    setTaxPct(18);
    setStartDate(todayISO());

    // If the start date is today (or past), raise the first invoice immediately.
    const generated = await runDueRecurring();
    for (const g of generated) toast(`Recurring: ${g.invoice_no} raised for ${g.customerName} (${inr.format(g.total)})`);
    await reload();
  }

  async function togglePause(p: RecurringProfile) {
    await updateProfile({ ...p, active: !p.active });
    toast(p.active ? `Paused — ${p.customerName} will not be invoiced` : `Resumed — next run ${formatShortDate(p.nextRun)}`, "info");
    await reload();
  }

  async function handleDelete(p: RecurringProfile) {
    if (!confirm(`Stop the recurring schedule for ${p.customerName}? Already-generated invoices stay in the books.`)) return;
    await deleteProfile(p.id);
    toast(`Recurring schedule for ${p.customerName} removed`);
    await reload();
  }

  const columns: Column<RecurringProfile>[] = [
    { key: "customerName", header: "Customer" },
    {
      key: "amount",
      header: "Amount / run",
      className: "text-right",
      render: (p) => <span className="font-semibold tabular-nums">{inr.format(profileTotal(p))}</span>,
      sortValue: (p) => profileTotal(p),
    },
    { key: "frequency", header: "Frequency", className: "capitalize" },
    {
      key: "nextRun",
      header: "Next invoice",
      render: (p) => (p.active ? formatShortDate(p.nextRun) : <span className="text-slate-400 dark:text-slate-500">—</span>),
    },
    {
      key: "lastGenerated",
      header: "Last raised",
      render: (p) => p.lastGenerated ?? <span className="text-slate-400 dark:text-slate-500">not yet</span>,
    },
    {
      key: "active",
      header: "Status",
      render: (p) =>
        p.active ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Paused
          </span>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (p) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton label={p.active ? "Pause schedule" : "Resume schedule"} shape="ghost" onClick={() => togglePause(p)}>
            {p.active ? ActionIcons.pause : ActionIcons.play}
          </IconButton>
          <IconButton label="Delete schedule" shape="ghost" variant="danger" onClick={() => handleDelete(p)}>
            {ActionIcons.delete}
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Recurring Invoices"
        subtitle="Set it once — the invoice raises itself every week or month, due per the customer's credit days."
        action={
          <div className="flex items-center gap-2">
            <IconLink label="Back to invoices" href="/invoices">
              {ActionIcons.back}
            </IconLink>
            {isConfigured && !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
              >
                + New Schedule
              </button>
            )}
          </div>
        }
      />

      {!isConfigured && <NotConfigured />}

      {isConfigured && showForm && (
        <section className="mb-8 animate-fade-in-up border-b border-slate-200 pb-8 dark:border-slate-800">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">New recurring schedule</h3>

          {formError && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Customer">
              <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Repeats">
              <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as "monthly" | "weekly")}>
                <option value="monthly">Every month</option>
                <option value="weekly">Every week</option>
              </select>
            </FormField>
            <FormField label="First invoice date">
              <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Tax (%)">
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={taxPct}
                onChange={(e) => setTaxPct(Number(e.target.value))}
              />
            </FormField>
          </div>

          {frequency === "monthly" && startDate && (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Will repeat on day {Number(startDate.split("-")[2])} of every month (clamped in shorter months).
            </p>
          )}

          <h4 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Line items</h4>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_7rem_7rem_2.5rem] items-center gap-2">
                <input
                  className={inputClass}
                  placeholder="Description (e.g. Monthly retainer — advisory services)"
                  value={it.description}
                  onChange={(e) => setItem(i, { description: e.target.value })}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  placeholder="Qty"
                  value={it.qty || ""}
                  onChange={(e) => setItem(i, { qty: Number(e.target.value) })}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  placeholder="Rate (₹)"
                  value={it.rate || ""}
                  onChange={(e) => setItem(i, { rate: Number(e.target.value) })}
                />
                <span className="text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">{inr.format(round2(it.qty * it.rate))}</span>
                <IconButton
                  label="Remove line"
                  shape="ghost"
                  variant="danger"
                  disabled={items.length === 1}
                  onClick={() => setItems((list) => list.filter((_, x) => x !== i))}
                >
                  {ActionIcons.delete}
                </IconButton>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setItems((list) => [...list, { ...BLANK_ITEM }])}
            className="mt-2 text-sm font-medium text-brand hover:underline dark:text-brand-300"
          >
            + Add line
          </button>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Subtotal {inr.format(subtotal)} + tax {taxPct}% ={" "}
              <span className="text-base font-bold text-slate-900 dark:text-white">{inr.format(total)}</span>
              <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">per {frequency === "monthly" ? "month" : "week"}</span>
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Start schedule"}
              </button>
            </div>
          </div>
        </section>
      )}

      {isConfigured &&
        (profiles === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={profiles}
            empty="No recurring schedules yet — click + New Schedule to set one up."
            searchPlaceholder="Search schedules…"
          />
        ))}

      <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
        Due invoices are raised automatically whenever the app is opened — dated on their scheduled day, numbered in sequence, and due per the
        customer&apos;s credit terms. Pause a schedule to skip runs without deleting it.
      </p>
    </div>
  );
}
