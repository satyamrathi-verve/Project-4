import type { ReactNode } from "react";

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** Shared input styling so every form looks the same. Use on <input>/<select>/<textarea>.
    Underline style — no rounded box, just a hairline rule beneath the value, so forms
    read like an accounting document grid (label over value, divided by hairlines). */
export const inputClass =
  "w-full rounded-none border-0 border-b border-slate-200 bg-transparent px-0 py-1.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-0 dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-400";

/** Open, un-boxed input for FILTER rows (search boxes, report controls): same underline
    treatment as `inputClass`, with slightly roomier padding for standalone toolbars. */
export const openInputClass =
  "w-full rounded-none border-0 border-b border-slate-200 bg-transparent px-0 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:ring-0 dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-400";
