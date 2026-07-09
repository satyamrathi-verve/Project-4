"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";
import type { GLAccount } from "@/lib/types";

const TYPES: GLAccount["type"][] = ["asset", "liability", "income", "expense"];

const TYPE_STYLES: Record<GLAccount["type"], string> = {
  asset: "bg-blue-50 text-blue-700",
  liability: "bg-amber-50 text-amber-700",
  income: "bg-emerald-50 text-emerald-700",
  expense: "bg-rose-50 text-rose-700",
};

// Derived from `type` — not stored columns, since the DB only has code/name/type/parent_group.
const NATURE: Record<GLAccount["type"], string> = {
  asset: "Debit",
  expense: "Debit",
  liability: "Credit",
  income: "Credit",
};

const STATEMENT: Record<GLAccount["type"], string> = {
  asset: "Balance Sheet",
  liability: "Balance Sheet",
  income: "P&L",
  expense: "P&L",
};

// Standard sub-groups per account type (matches the seeded data's parent_group values).
const GROUPS_BY_TYPE: Record<GLAccount["type"], string[]> = {
  asset: ["Current Assets", "Fixed Assets", "Investments"],
  liability: ["Current Liabilities", "Non-Current Liabilities", "Capital & Reserves"],
  income: ["Revenue", "Indirect Income"],
  expense: ["Direct Expenses", "Indirect Expenses"],
};

export default function GLMasterPage() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<GLAccount["type"]>("asset");
  const [parentGroup, setParentGroup] = useState(GROUPS_BY_TYPE.asset[0]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadAccounts() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("gl_accounts").select("*").order("code");
    if (error) setError(error.message);
    else setAccounts(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setType("asset");
    setParentGroup(GROUPS_BY_TYPE.asset[0]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !code.trim() || !name.trim() || !parentGroup) return;

    setSaving(true);
    setError(null);
    const payload = { code: code.trim(), name: name.trim(), type, parent_group: parentGroup };
    const { error } = editingId
      ? await supabase.from("gl_accounts").update(payload).eq("id", editingId)
      : await supabase.from("gl_accounts").insert(payload);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    loadAccounts();
  }

  function handleEditSelected() {
    if (selected.size !== 1) return;
    const [id] = selected;
    const account = accounts.find((a) => a.id === id);
    if (!account) return;

    setEditingId(account.id);
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setParentGroup(account.parent_group ?? GROUPS_BY_TYPE[account.type][0]);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(accounts.map((a) => a.id)) : new Set());
  }

  async function handleDelete() {
    if (!supabase || selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(`Delete ${count} selected GL account${count > 1 ? "s" : ""}? This can't be undone.`)) {
      return;
    }

    setDeleting(true);
    setError(null);
    const { error } = await supabase.from("gl_accounts").delete().in("id", Array.from(selected));
    setDeleting(false);

    if (error) {
      setError(error.message);
      return;
    }
    if (editingId && selected.has(editingId)) resetForm();
    setSelected(new Set());
    loadAccounts();
  }

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "GL Code" },
    { key: "name", header: "Account Name" },
    {
      key: "type",
      header: "Account Type",
      render: (row) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TYPE_STYLES[row.type]}`}>
          {row.type}
        </span>
      ),
    },
    { key: "parent_group", header: "Sub Type", render: (row) => row.parent_group ?? "—" },
    { key: "nature", header: "Nature", render: (row) => NATURE[row.type] },
    { key: "statement", header: "Balance Sheet / P&L", render: (row) => STATEMENT[row.type] },
  ];

  return (
    <>
      <PageHeader title="GL Master" subtitle="The reference list of ledger accounts — Sales, Debtors, Bank, Discount…" />

      {!isConfigured ? (
        <NotConfigured />
      ) : (
        <div className="space-y-6">
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-4"
          >
            <FormField label="Code">
              <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required />
            </FormField>
            <FormField label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </FormField>
            <FormField label="Type">
              <select
                className={inputClass}
                value={type}
                onChange={(e) => {
                  const nextType = e.target.value as GLAccount["type"];
                  setType(nextType);
                  setParentGroup(GROUPS_BY_TYPE[nextType][0]);
                }}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Parent Group">
              <select
                className={inputClass}
                value={parentGroup}
                onChange={(e) => setParentGroup(e.target.value)}
                required
              >
                {GROUPS_BY_TYPE[type].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="flex items-center gap-3 sm:col-span-4">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? (editingId ? "Saving…" : "Adding…") : editingId ? "Save Changes" : "Add Account"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {selected.size > 0 ? `${selected.size} selected` : "Select a row to edit or delete."}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleEditSelected}
                disabled={selected.size !== 1}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={selected.size === 0 || deleting}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading accounts…</p>
          ) : (
            <DataTable
              columns={columns}
              rows={accounts}
              empty="No GL accounts yet."
              selectedIds={selected}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
            />
          )}
        </div>
      )}
    </>
  );
}
