/*
  A plain "Export" button matching the outline-brand style the AR Ageing
  report's export control already established — reuse this instead of
  restyling per screen. Screens with just one export shape use this directly;
  screens needing a template/format picker (like Ageing) can keep their own
  richer dropdown built on the same visual language.
*/
export function ExportButton({ onClick, label = "Export" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition-all duration-200 hover:bg-brand-50 active:scale-95 dark:border-brand-300 dark:text-brand-300 dark:hover:bg-brand-900/30"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
