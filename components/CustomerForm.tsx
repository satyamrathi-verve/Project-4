"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import {
  CUSTOMER_STATUSES,
  EXPORT_CURRENCIES,
  GSTIN_REGEX,
  MSME_STATUSES,
  REGISTRATION_TYPES,
  customerFormSchema,
} from "@/lib/validation/customer";
import { FormField, inputClass } from "@/components/FormField";
import { CollapsibleSection } from "@/components/CollapsibleSection";

/*
  Shared create/edit form for Customer Master. Basic Details covers what
  every other screen depends on (code, name, address, credit terms);
  Advanced Details (collapsed by default) covers GST/TDS/MSME/export/banking
  fields that most customers don't need on day one.
*/

type FieldValues = {
  code: string;
  name: string;
  gstin: string;
  pan: string;
  registration_type: string;
  billing_address: string;
  shipping_address: string;
  state: string;
  state_code: string;
  contact_person: string;
  phone: string;
  email: string;
  opening_balance: string;
  credit_days: string;
  credit_limit: string;
  place_of_supply: string;
  tds_applicable: boolean;
  tds_section: string;
  tcs_applicable: boolean;
  msme_status: string;
  udyam_number: string;
  bank_account_no: string;
  bank_ifsc: string;
  currency: string;
  is_export_client: boolean;
  lut_number: string;
  status: string;
  remarks: string;
};

function emptyValues(): FieldValues {
  return {
    code: "",
    name: "",
    gstin: "",
    pan: "",
    registration_type: "REGULAR",
    billing_address: "",
    shipping_address: "",
    state: "",
    state_code: "",
    contact_person: "",
    phone: "",
    email: "",
    opening_balance: "0",
    credit_days: "30",
    credit_limit: "0",
    place_of_supply: "",
    tds_applicable: false,
    tds_section: "",
    tcs_applicable: false,
    msme_status: "NA",
    udyam_number: "",
    bank_account_no: "",
    bank_ifsc: "",
    currency: "INR",
    is_export_client: false,
    lut_number: "",
    status: "ACTIVE",
    remarks: "",
  };
}

function valuesFromCustomer(c: Customer): FieldValues {
  return {
    code: c.code,
    name: c.name,
    gstin: c.gstin ?? "",
    pan: c.pan ?? "",
    registration_type: c.registration_type ?? "REGULAR",
    billing_address: c.billing_address ?? "",
    shipping_address: c.shipping_address ?? "",
    state: c.state ?? "",
    state_code: c.state_code ?? "",
    contact_person: c.contact_person ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    opening_balance: String(c.opening_balance ?? 0),
    credit_days: String(c.credit_days ?? 30),
    credit_limit: String(c.credit_limit ?? 0),
    place_of_supply: c.place_of_supply ?? "",
    tds_applicable: c.tds_applicable ?? false,
    tds_section: c.tds_section ?? "",
    tcs_applicable: c.tcs_applicable ?? false,
    msme_status: c.msme_status ?? "NA",
    udyam_number: c.udyam_number ?? "",
    bank_account_no: c.bank_account_no ?? "",
    bank_ifsc: c.bank_ifsc ?? "",
    currency: c.currency ?? "INR",
    is_export_client: c.is_export_client ?? false,
    lut_number: c.lut_number ?? "",
    status: c.status ?? "ACTIVE",
    remarks: c.remarks ?? "",
  };
}

const checkboxClass =
  "h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600 dark:bg-slate-800";

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input
        type="checkbox"
        className={checkboxClass}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function CustomerForm({ mode, initial }: { mode: "create" | "edit"; initial?: Customer }) {
  const router = useRouter();
  const [values, setValues] = useState<FieldValues>(initial ? valuesFromCustomer(initial) : emptyValues());
  const [sameAsBilling, setSameAsBilling] = useState(
    initial ? !initial.shipping_address || initial.shipping_address === initial.billing_address : true
  );
  const [panTouched, setPanTouched] = useState(Boolean(initial?.pan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FieldValues>(key: K, value: FieldValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleGstinChange(raw: string) {
    const gstin = raw.toUpperCase();
    set("gstin", gstin);
    if (GSTIN_REGEX.test(gstin)) {
      if (!panTouched) set("pan", gstin.slice(2, 12));
      if (!values.state_code) set("state_code", gstin.slice(0, 2));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = customerFormSchema.safeParse({
      ...values,
      shipping_address: sameAsBilling ? "" : values.shipping_address,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      // Always surface a visible error, even for fields that don't render their
      // own inline message — a validation failure must never be silent.
      setSubmitError(
        `Couldn't save: ${parsed.error.issues.map((i) => i.message).join("; ")}`
      );
      return;
    }
    setErrors({});

    if (!supabase) {
      setSubmitError("Supabase isn't connected.");
      return;
    }

    setSaving(true);
    const payload = { ...parsed.data, gstin: parsed.data.gstin || null, pan: parsed.data.pan || null };

    const { error } = mode === "create"
      ? await supabase.from("customers").insert(payload)
      : await supabase.from("customers").update(payload).eq("id", initial!.id);

    setSaving(false);

    if (error) {
      setSubmitError(
        error.code === "23505"
          ? "That customer code is already in use — pick a different one."
          : error.message
      );
      return;
    }

    router.push("/masters/customers");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <CollapsibleSection title="Basic Details" subtitle="Identity, address, contact and credit terms." defaultOpen>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Customer Code">
            <input className={inputClass} value={values.code} onChange={(e) => set("code", e.target.value)} />
            {errors.code && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.code}</p>}
          </FormField>
          <FormField label="Name">
            <input className={inputClass} value={values.name} onChange={(e) => set("name", e.target.value)} />
            {errors.name && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.name}</p>}
          </FormField>

          <FormField label="GSTIN">
            <input
              className={inputClass}
              value={values.gstin}
              maxLength={15}
              placeholder="27AABCS1111A1Z1"
              onChange={(e) => handleGstinChange(e.target.value)}
            />
            {errors.gstin && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.gstin}</p>}
          </FormField>
          <FormField label="PAN">
            <input
              className={inputClass}
              value={values.pan}
              maxLength={10}
              placeholder="Auto-filled from GSTIN"
              onChange={(e) => {
                setPanTouched(true);
                set("pan", e.target.value.toUpperCase());
              }}
            />
            {errors.pan && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.pan}</p>}
          </FormField>

          <FormField label="Registration Type">
            <select className={inputClass} value={values.registration_type} onChange={(e) => set("registration_type", e.target.value)}>
              {REGISTRATION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {errors.registration_type && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.registration_type}</p>}
          </FormField>
          <FormField label="Status">
            <select className={inputClass} value={values.status} onChange={(e) => set("status", e.target.value)}>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.status && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.status}</p>}
          </FormField>

          <FormField label="State">
            <input className={inputClass} value={values.state} onChange={(e) => set("state", e.target.value)} />
          </FormField>
          <FormField label="State Code">
            <input className={inputClass} value={values.state_code} onChange={(e) => set("state_code", e.target.value)} />
          </FormField>

          <div className="sm:col-span-2">
            <FormField label="Billing Address">
              <textarea
                className={`${inputClass} min-h-20`}
                value={values.billing_address}
                onChange={(e) => set("billing_address", e.target.value)}
              />
              {errors.billing_address && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.billing_address}</p>}
            </FormField>
          </div>

          <div className="sm:col-span-2 flex flex-col gap-2">
            <CheckboxField label="Shipping address same as billing" checked={sameAsBilling} onChange={setSameAsBilling} />
            {!sameAsBilling && (
              <FormField label="Shipping Address">
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={values.shipping_address}
                  onChange={(e) => set("shipping_address", e.target.value)}
                />
              </FormField>
            )}
          </div>

          <FormField label="Contact Person">
            <input className={inputClass} value={values.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
          </FormField>
          <FormField label="Phone">
            <input className={inputClass} value={values.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
          <FormField label="Email">
            <input className={inputClass} value={values.email} onChange={(e) => set("email", e.target.value)} />
            {errors.email && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.email}</p>}
          </FormField>

          <div className="sm:col-span-2">
            <FormField label="Opening Balance">
              <input
                type="number"
                step="0.01"
                className={`${inputClass} max-w-xs`}
                value={values.opening_balance}
                onChange={(e) => set("opening_balance", e.target.value)}
              />
            </FormField>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Positive = customer owes us (receivable). Negative = we owe them (credit balance).
            </p>
          </div>

          <FormField label="Credit Period (days)">
            <input
              type="number"
              className={inputClass}
              value={values.credit_days}
              onChange={(e) => set("credit_days", e.target.value)}
            />
            {errors.credit_days && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.credit_days}</p>}
          </FormField>
          <FormField label="Credit Limit">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={values.credit_limit}
              onChange={(e) => set("credit_limit", e.target.value)}
            />
            {errors.credit_limit && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.credit_limit}</p>}
          </FormField>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced Details"
        subtitle="GST compliance, TDS/TCS, MSME, banking and export information."
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Place of Supply">
            <input className={inputClass} value={values.place_of_supply} onChange={(e) => set("place_of_supply", e.target.value)} />
          </FormField>
          <div />

          <div className="flex flex-col gap-2">
            <CheckboxField label="TDS Applicable" checked={values.tds_applicable} onChange={(v) => set("tds_applicable", v)} />
            {values.tds_applicable && (
              <FormField label="TDS Section">
                <input className={inputClass} value={values.tds_section} onChange={(e) => set("tds_section", e.target.value)} />
                {errors.tds_section && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.tds_section}</p>}
              </FormField>
            )}
          </div>
          <CheckboxField label="TCS Applicable" checked={values.tcs_applicable} onChange={(v) => set("tcs_applicable", v)} />

          <FormField label="MSME Status">
            <select className={inputClass} value={values.msme_status} onChange={(e) => set("msme_status", e.target.value)}>
              {MSME_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.msme_status && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.msme_status}</p>}
          </FormField>
          {values.msme_status !== "NA" && (
            <FormField label="Udyam Number">
              <input className={inputClass} value={values.udyam_number} onChange={(e) => set("udyam_number", e.target.value)} />
              {errors.udyam_number && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.udyam_number}</p>}
            </FormField>
          )}

          <FormField label="Bank Account No.">
            <input className={inputClass} value={values.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} />
          </FormField>
          <FormField label="Bank IFSC">
            <input className={inputClass} value={values.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value)} />
          </FormField>

          <div className="flex flex-col gap-2">
            <CheckboxField label="Export Client" checked={values.is_export_client} onChange={(v) => set("is_export_client", v)} />
            {values.is_export_client && (
              <FormField label="LUT Number">
                <input className={inputClass} value={values.lut_number} onChange={(e) => set("lut_number", e.target.value)} />
                {errors.lut_number && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.lut_number}</p>}
              </FormField>
            )}
          </div>
          {values.is_export_client && (
            <FormField label="Currency">
              <select className={inputClass} value={values.currency} onChange={(e) => set("currency", e.target.value)}>
                {EXPORT_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FormField>
          )}

          <div className="sm:col-span-2">
            <FormField label="Remarks">
              <textarea className={`${inputClass} min-h-20`} value={values.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </FormField>
          </div>
        </div>
      </CollapsibleSection>

      {submitError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {submitError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:opacity-60"
        >
          {saving ? "Saving…" : mode === "create" ? "Create Customer" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/masters/customers")}
          className="rounded-lg px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
