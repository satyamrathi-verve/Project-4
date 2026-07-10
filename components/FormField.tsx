import type { ReactNode } from "react";

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** Shared input styling so every form looks the same. Use on <input>/<select>. */
export const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-400";

/** Open, un-boxed input for FILTER rows (search boxes, report controls): no box,
    just an underline that lights up on focus. Keep `inputClass` for data-entry forms. */
export const openInputClass =
  "w-full border-0 border-b border-slate-300 bg-transparent px-1 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-b-2 focus:border-brand dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-400";
