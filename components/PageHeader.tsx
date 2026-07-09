import type { ReactNode } from "react";

/* Open section header — a title/subtitle over a hairline divider, no boxed chrome. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
      <div>
        <h2 className="text-2xl font-bold text-brand dark:text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
