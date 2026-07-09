"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import type { GLAccount } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { IconButton, ActionIcons } from "@/components/IconButton";
import { NotConfigured } from "@/components/NotConfigured";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, inputClass } from "@/components/FormField";

type GLType = GLAccount["type"];

const TYPE_OPTIONS: { value: GLType; label: string }[] = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

const TYPE_BADGE: Record<GLType, string> = {
  asset: "bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand-300",
  liability: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  income: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  expense: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const EMPTY_FORM = { id: "", code: "", name: "", type: "asset" as GLType, parent_group: "" };

export default function GLMasterPage() {
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<GLType | "ALL">("ALL");

  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);

  async function load() {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("gl_accounts").select("*").order("code");
    if (error) {
      setError(error.message);
      setAccounts([]);
    } else {
      setAccounts((data as GLAccount[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const parentGroups = useMemo(() => {
    const set = new Set(accounts.map((a) => a.parent_group).filter((g): g is string => Boolean(g)));
    return Array.from(set).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
      if (!q) return true;
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [accounts, search, typeFilter]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setIsEditing(false);
  }

  function startEdit(account: GLAccount) {
    setForm({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      parent_group: account.parent_group ?? "",
    });
    setIsEditing(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError(null);

    const payload = {
      code: form.code,
      name: form.name,
      type: form.type,
      parent_group: form.parent_group || null,
    };

    const resp =
      isEditing && form.id
        ? await supabase.from("gl_accounts").update(payload).eq("id", form.id).select().single()
        : await supabase.from("gl_accounts").insert(payload).select().single();

    if (resp.error) {
      setError(resp.error.message);
    } else {
      resetForm();
      await load();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!supabase) return;
    if (!confirm("Delete this GL account? This can't be undone.")) return;
    const { error: delErr } = await supabase.from("gl_accounts").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    if (form.id === id) resetForm();
    await load();
  }

  const columns: Column<GLAccount>[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "type",
      header: "Type",
      render: (a) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${TYPE_BADGE[a.type]}`}>{a.type}</span>
      ),
    },
    { key: "parent_group", header: "Parent Group", render: (a) => a.parent_group ?? "—" },
    {
      key: "id",
      header: "Action",
      render: (a) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton label="Edit account" shape="ghost" onClick={() => startEdit(a)}>
            {ActionIcons.edit}
          </IconButton>
          <IconButton label="Delete account" shape="ghost" variant="danger" onClick={() => handleDelete(a.id)}>
            {ActionIcons.delete}
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="GL Master"
        subtitle="The chart of accounts every invoice and receipt ultimately posts against."
        action={
          <button
            onClick={resetForm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95"
          >
            New account
          </button>
        }
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

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as GLType | "ALL")}
              className={inputClass}
            >
              <option value="ALL">All types</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {filtered.length} of {accounts.length} accounts
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={filtered} empty="No GL accounts match your search." />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {isEditing ? "Edit account" : "Add account"}
          </h3>
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
            <FormField label="Code">
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={inputClass}
                placeholder="4600"
              />
            </FormField>

            <FormField label="Name">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                placeholder="Freight & Forwarding"
              />
            </FormField>

            <FormField label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as GLType })}
                className={inputClass}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Parent group">
              <input
                list="parent-group-options"
                value={form.parent_group}
                onChange={(e) => setForm({ ...form, parent_group: e.target.value })}
                className={inputClass}
                placeholder="Direct Expenses"
              />
              <datalist id="parent-group-options">
                {parentGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </FormField>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : isEditing ? "Save changes" : "Create account"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
