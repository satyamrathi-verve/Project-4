"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface Column<T> {
  key: string;
  header: string;
  /** Optional custom cell; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  className?: string;
  /** Sorting is on by default; set false to make this column unsortable. */
  sortable?: boolean;
  /** Custom value to sort by (defaults to row[key]). */
  sortValue?: (row: T) => string | number;
  /** Show a filter dropdown for this column in the toolbar. */
  filterable?: boolean;
  /** Text used for filtering + search + distinct values (defaults to String(row[key])). */
  filterValue?: (row: T) => string;
}

/*
  Open, un-boxed data table. No surrounding card — just an underlined header and
  hairline rows, so lists read like an open ledger. Every table gets, for free:
   • a search box (matches text across all columns),
   • click-to-sort on every column (▲/▼),
   • a filter dropdown for any column marked `filterable`.
  Pass `getRowHref` (or `onRowClick`) to make whole rows clickable.
*/
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
  onRowClick,
  getRowHref,
  searchable = true,
  searchPlaceholder = "Search…",
  toolbar,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  onRowClick?: (row: T) => void;
  getRowHref?: (row: T) => string;
  /** Show the search box (default true). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Extra controls rendered on the right of the toolbar (e.g. an Export button). */
  toolbar?: ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  // Per-column multi-select filters: column key -> selected (trimmed) values.
  // Empty/missing array = no filter for that column.
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  const filterableCols = columns.filter((c) => c.filterable);

  const textOf = (row: T, c: Column<T>): string => {
    if (c.filterValue) return c.filterValue(row);
    const v = (row as Record<string, unknown>)[c.key];
    return v == null ? "" : String(v);
  };
  const sortOf = (row: T, c: Column<T>): string | number => {
    if (c.sortValue) return c.sortValue(row);
    const v = (row as Record<string, unknown>)[c.key];
    if (typeof v === "number") return v;
    return v == null ? "" : String(v);
  };

  const distinct = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of filterableCols) {
      const set = new Set<string>();
      for (const r of rows) {
        // Trim consistently; keep "" so null/blank cells are filterable (shown as an em-dash).
        set.add(textOf(r, c).trim());
      }
      map[c.key] = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  const view = useMemo(() => {
    let out = rows;
    for (const c of filterableCols) {
      const sel = filters[c.key];
      // Match against the same trimmed value used to build the distinct list.
      if (sel && sel.length > 0) out = out.filter((r) => sel.includes(textOf(r, c).trim()));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((r) => {
        // Search only the displayed column values (not the raw row object).
        const hay = columns.map((c) => textOf(r, c)).join(" ");
        return hay.toLowerCase().includes(q);
      });
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = sortOf(a, col);
          const bv = sortOf(b, col);
          let cmp: number;
          if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
          else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, query, sort, filters]);

  function toggleSort(c: Column<T>) {
    if (c.sortable === false) return;
    setSort((s) =>
      s && s.key === c.key ? (s.dir === "asc" ? { key: c.key, dir: "desc" } : null) : { key: c.key, dir: "asc" }
    );
  }

  const hasActiveFilters = Object.values(filters).some((f) => f.length > 0);
  const showToolbar = searchable || hasActiveFilters || toolbar;

  return (
    <div>
      {showToolbar && (
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          {searchable && (
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-56 border-0 border-b border-slate-300 bg-transparent py-1.5 pl-8 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-b-2 focus:border-brand dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-400"
              />
            </div>
          )}
          {(query || hasActiveFilters) && (
            <button
              type="button"
              onClick={() => { setQuery(""); setFilters({}); }}
              className="text-sm font-medium text-slate-400 hover:text-brand dark:text-slate-500"
            >
              Clear
            </button>
          )}
          <span className="ml-auto flex items-center gap-3">
            <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
              {view.length}{view.length !== rows.length ? ` of ${rows.length}` : ""}
            </span>
            {toolbar}
          </span>
        </div>
      )}

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left dark:border-slate-700">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const canSort = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    className={`whitespace-nowrap px-4 py-2.5 font-semibold text-slate-500 dark:text-slate-400 ${canSort ? "cursor-pointer select-none hover:text-brand dark:hover:text-brand-300" : ""} ${c.className ?? ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {canSort && (
                        <span className={`text-[10px] ${active ? "text-brand dark:text-brand-300" : "text-slate-300 dark:text-slate-600"}`}>
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      )}
                      {c.filterable && (
                        <ColumnMenu
                          header={c.header}
                          values={distinct[c.key] ?? []}
                          selected={filters[c.key] ?? []}
                          onChange={(next) => setFilters((f) => ({ ...f, [c.key]: next }))}
                          sortable={canSort}
                          onSort={(dir) => setSort({ key: c.key, dir })}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                  {rows.length === 0 ? empty : "No rows match your search or filters."}
                </td>
              </tr>
            ) : (
              view.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : getRowHref ? () => router.push(getRowHref(row)) : undefined}
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/70 dark:hover:bg-slate-800/40 ${onRowClick || getRowHref ? "cursor-pointer" : ""}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${c.className ?? ""}`}>
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/*
  Excel-style column menu: a funnel icon in the header opens a popover with
  sort actions, a value search box, select/clear-all, and a multi-select
  checkbox list of the column's distinct (trimmed) values. Values may include
  "" (blank/null cells), displayed as an em-dash.
*/
function ColumnMenu({
  header,
  values,
  selected,
  onChange,
  sortable,
  onSort,
}: {
  header: string;
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  sortable: boolean;
  onSort: (dir: "asc" | "desc") => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filterActive = selected.length > 0;
  const q = search.trim().toLowerCase();
  const visible = q ? values.filter((v) => (v === "" ? "—" : v).toLowerCase().includes(q)) : values;

  const toggleValue = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  const menuItemClass =
    "block w-full rounded px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60";

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Filter ${header}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setSearch("");
        }}
        className={`relative rounded p-0.5 transition-colors ${
          filterActive
            ? "text-brand dark:text-brand-300"
            : "text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
        }`}
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill={filterActive ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {filterActive && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand dark:bg-brand-300" />
        )}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1.5 w-60 cursor-default whitespace-normal rounded-xl border border-slate-200 bg-white p-2 text-left font-normal shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {sortable && (
            <div className="mb-1 border-b border-slate-100 pb-1 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  onSort("asc");
                  setOpen(false);
                }}
                className={menuItemClass}
              >
                ↑ Sort ascending
              </button>
              <button
                type="button"
                onClick={() => {
                  onSort("desc");
                  setOpen(false);
                }}
                className={menuItemClass}
              >
                ↓ Sort descending
              </button>
            </div>
          )}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search values..."
            className="mb-1.5 w-full rounded-md border border-slate-200 bg-transparent px-2 py-1 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-400"
          />

          <div className="mb-1 flex items-center justify-between px-1 text-xs text-slate-400 dark:text-slate-500">
            <span className="tabular-nums">{selected.length} selected</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(Array.from(new Set([...selected, ...visible])))}
                className="font-medium text-brand hover:underline dark:text-brand-300"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-medium hover:text-brand hover:underline dark:hover:text-brand-300"
              >
                Clear all
              </button>
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                No matching values
              </div>
            ) : (
              visible.map((v) => {
                const label = v === "" ? "—" : v;
                return (
                  <label
                    key={v === "" ? "__empty__" : v}
                    title={label}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(v)}
                      onChange={() => toggleValue(v)}
                      className="h-3.5 w-3.5 shrink-0 accent-brand dark:accent-brand-400"
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </span>
  );
}
