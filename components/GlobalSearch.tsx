"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Result = { kind: "customer" | "invoice"; id: string; primary: string; secondary: string; href: string };

/*
  App-wide search in the top bar. Looks across customers (code / name) and invoices
  (invoice no) as you type and shows a dropdown of matches, each linking to its screen.
  Open, borderless field that expands on focus — no boxed chrome.
*/
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!supabase || term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      const [cust, inv] = await Promise.all([
        supabase!.from("customers").select("id,code,name").or(`name.ilike.${like},code.ilike.${like}`).limit(6),
        supabase!.from("invoices").select("id,invoice_no,total,status").ilike("invoice_no", like).limit(6),
      ]);
      if (cancelled) return;
      const out: Result[] = [];
      (cust.data ?? []).forEach((c: { id: string; code: string; name: string }) =>
        out.push({ kind: "customer", id: c.id, primary: c.name, secondary: c.code, href: `/masters/customers/${c.id}` })
      );
      (inv.data ?? []).forEach((i: { id: string; invoice_no: string; status: string }) =>
        out.push({ kind: "invoice", id: i.id, primary: i.invoice_no, secondary: i.status, href: `/invoices/${i.id}` })
      );
      setResults(out);
      setActive(0);
      setOpen(true);
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  function go(r: Result) {
    setOpen(false);
    setQ("");
    router.push(r.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <svg className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search customers, invoices…"
        aria-label="Global search"
        className="w-full border-0 border-b border-transparent bg-transparent py-2 pl-6 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300 dark:text-slate-200 dark:focus:border-slate-600"
      />

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400 dark:text-slate-500">No matches for “{q}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.kind}-${r.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-slate-100 dark:bg-slate-800" : ""}`}
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${r.kind === "customer" ? "bg-brand-50 text-brand dark:bg-brand-900/40 dark:text-brand-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                  {r.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{r.primary}</span>
                <span className="flex-none text-xs text-slate-400 dark:text-slate-500">{r.secondary}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
