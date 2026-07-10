"use client";

import { useEffect, useState } from "react";
import { inputClass } from "@/components/FormField";

export interface SearchableOption {
  id: string;
  label: string;
  sublabel?: string;
}

/*
  A text input that filters a dropdown of options as you type. Used for
  customer selection (and anywhere else a searchable picker is needed).
  Reports the chosen option's id via onChange.
*/
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
}: {
  options: SearchableOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const selected = options.find((o) => o.id === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected?.label ?? "");
  }, [selected?.id]);

  const filtered =
    query.trim() === "" || query === selected?.label
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <input
        className={inputClass}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 dark:text-slate-300 dark:hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setQuery(o.label);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{o.label}</span>
                {o.sublabel && <span className="text-xs text-slate-400 dark:text-slate-500">{o.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
          No matches
        </div>
      )}
    </div>
  );
}
