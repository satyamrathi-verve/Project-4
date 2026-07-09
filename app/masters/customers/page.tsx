'use client';

import { useEffect, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { FormField, inputClass } from '@/components/FormField';
import { NotConfigured } from '@/components/NotConfigured';
import { PageHeader } from '@/components/PageHeader';
import { isConfigured, supabase } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

const emptyForm = {
  id: '',
  code: '',
  name: '',
  gstin: '',
  pan: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  credit_limit: '0',
  credit_days: '0',
  opening_balance: '0',
};

export default function CustomerMasterPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isEditing, setIsEditing] = useState(false);

  async function loadCustomers() {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('code', { ascending: true });

    if (error) {
      setError(error.message);
      setCustomers([]);
    } else {
      setCustomers((data as Customer[]) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setIsEditing(false);
  }

  function startEdit(customer: Customer) {
    setForm({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      gstin: customer.gstin ?? '',
      pan: customer.pan ?? '',
      contact_person: customer.contact_person ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      credit_limit: String(customer.credit_limit ?? 0),
      credit_days: String(customer.credit_days ?? 0),
      opening_balance: String(customer.opening_balance ?? 0),
    });
    setIsEditing(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      code: form.code,
      name: form.name,
      gstin: form.gstin || null,
      pan: form.pan || null,
      contact_person: form.contact_person || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      credit_limit: Number(form.credit_limit || 0),
      credit_days: Number(form.credit_days || 0),
      opening_balance: Number(form.opening_balance || 0),
    };

    let response;
    if (isEditing && form.id) {
      response = await supabase.from('customers').update(payload).eq('id', form.id).select().single();
    } else {
      response = await supabase.from('customers').insert(payload).select().single();
    }

    if (response.error) {
      setError(response.error.message);
    } else {
      resetForm();
      await loadCustomers();
    }

    setSaving(false);
  }

  return (
    <>
      <PageHeader
        title="Customer Master"
        subtitle="A simple list of customers you can read, add, and edit from the existing Supabase data."
        action={
          <button
            onClick={() => {
              resetForm();
            }}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            New customer
          </button>
        }
      />

      {!isConfigured && (
        <div className="mb-6">
          <NotConfigured />
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Customer list</h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Loading customers…</p>
          ) : (
            <div className="mt-4">
              <DataTable
                columns={[
                  { key: 'code', header: 'Code' },
                  { key: 'name', header: 'Name' },
                  {
                    key: 'contact_person',
                    header: 'Contact',
                    render: (customer) => customer.contact_person ?? customer.email ?? customer.phone ?? '—',
                  },
                  {
                    key: 'credit_days',
                    header: 'Credit Days',
                    render: (customer) => customer.credit_days,
                  },
                  {
                    key: 'credit_limit',
                    header: 'Credit Limit',
                    render: (customer) => `₹${customer.credit_limit.toLocaleString()}`,
                  },
                  {
                    key: 'id',
                    header: 'Action',
                    render: (customer) => (
                      <button
                        onClick={() => startEdit(customer)}
                        className="text-sm font-medium text-brand"
                      >
                        Edit
                      </button>
                    ),
                  },
                ]}
                rows={customers}
                empty="No customers found yet."
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {isEditing ? 'Edit customer' : 'Add customer'}
          </h3>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Customer code">
                <input
                  required
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  className={inputClass}
                  placeholder="CUST001"
                />
              </FormField>

              <FormField label="Customer name">
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className={inputClass}
                  placeholder="Acme Industries"
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Contact person">
                <input
                  value={form.contact_person}
                  onChange={(event) => setForm({ ...form, contact_person: event.target.value })}
                  className={inputClass}
                  placeholder="Asha Rao"
                />
              </FormField>

              <FormField label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className={inputClass}
                  placeholder="ops@acme.com"
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Phone">
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className={inputClass}
                  placeholder="9876543210"
                />
              </FormField>

              <FormField label="GSTIN">
                <input
                  value={form.gstin}
                  onChange={(event) => setForm({ ...form, gstin: event.target.value })}
                  className={inputClass}
                  placeholder="27AAAAA0000A1Z5"
                />
              </FormField>
            </div>

            <FormField label="Address">
              <textarea
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                className={`${inputClass} min-h-24`}
                placeholder="Street, city, state"
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Credit limit">
                <input
                  type="number"
                  min="0"
                  value={form.credit_limit}
                  onChange={(event) => setForm({ ...form, credit_limit: event.target.value })}
                  className={inputClass}
                />
              </FormField>

              <FormField label="Credit days">
                <input
                  type="number"
                  min="0"
                  value={form.credit_days}
                  onChange={(event) => setForm({ ...form, credit_days: event.target.value })}
                  className={inputClass}
                />
              </FormField>

              <FormField label="Opening balance">
                <input
                  type="number"
                  min="0"
                  value={form.opening_balance}
                  onChange={(event) => setForm({ ...form, opening_balance: event.target.value })}
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create customer'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
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
