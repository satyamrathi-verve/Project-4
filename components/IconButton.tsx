"use client";

import Link from "next/link";
import type { ReactNode, MouseEventHandler } from "react";

/*
  Icon-only action buttons with a tooltip (native title) and screen-reader label.
  Two shapes:
   - IconButton / IconLink  — bordered 36px buttons for page headers ("bordered"),
     or borderless 30px hover-tint buttons for table rows ("ghost").
  Variants: default (slate → brand on hover), primary (solid brand), danger (red).
  Always pass `label` — it is the tooltip AND the aria-label, so icon-only stays accessible.
*/

type Variant = "default" | "primary" | "danger";
type Shape = "bordered" | "ghost";

function classes(variant: Variant, shape: Shape, disabled?: boolean): string {
  const size = shape === "bordered" ? "h-9 w-9 rounded-lg" : "h-8 w-8 rounded-md";
  const base = `inline-flex flex-none items-center justify-center ${size} transition-all duration-150 active:scale-90`;
  const dis = disabled ? " cursor-not-allowed opacity-40" : "";
  if (variant === "primary")
    return `${base} border border-transparent bg-brand text-white hover:bg-brand-700${dis}`;
  if (variant === "danger")
    return shape === "bordered"
      ? `${base} border border-slate-300 text-red-500 hover:border-red-400 hover:bg-red-50 dark:border-slate-700 dark:hover:border-red-500/60 dark:hover:bg-red-900/20${dis}`
      : `${base} text-red-500 hover:bg-red-50 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-900/30${dis}`;
  return shape === "bordered"
    ? `${base} border border-slate-300 text-slate-500 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-400 dark:hover:text-brand-300${dis}`
    : `${base} text-slate-400 hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-brand-300${dis}`;
}

export function IconButton({
  label,
  onClick,
  variant = "default",
  shape = "bordered",
  disabled,
  children,
}: {
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  variant?: Variant;
  shape?: Shape;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={classes(variant, shape, disabled)}>
      {children}
    </button>
  );
}

export function IconLink({
  label,
  href,
  variant = "default",
  shape = "bordered",
  children,
}: {
  label: string;
  href: string;
  variant?: Variant;
  shape?: Shape;
  children: ReactNode;
}) {
  return (
    <Link href={href} title={label} aria-label={label} className={classes(variant, shape)}>
      {children}
    </Link>
  );
}

/* ---- The action icon set (18px line icons, consistent stroke) ---- */

function I({ children, spin = false }: { children: ReactNode; spin?: boolean }) {
  return (
    <svg
      className={`h-[18px] w-[18px] ${spin ? "animate-spin" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ActionIcons = {
  view: (
    <I>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </I>
  ),
  edit: (
    <I>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </I>
  ),
  print: (
    <I>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </I>
  ),
  delete: (
    <I>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </I>
  ),
  mail: (
    <I>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </I>
  ),
  back: (
    <I>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </I>
  ),
  hide: (
    <I>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </I>
  ),
  check: (
    <I>
      <polyline points="20 6 9 17 4 12" />
    </I>
  ),
  refresh: (
    <I>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </I>
  ),
  spinner: (
    <I spin>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </I>
  ),
} as const;
