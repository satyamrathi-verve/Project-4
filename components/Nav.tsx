"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession, signOut } from "@/lib/auth";
import { ScreenIcon } from "./icons";

/*
  Left sidebar. Only "Home" exists to start with — everything else is the roadmap
  your team builds. Each unbuilt screen shows a "build me" tag. When you finish a
  screen, flip its `built` to true (and point `href` at the route you created) so it
  turns into a real link. Sign In isn't listed here — it's the pre-auth gate, not
  an in-app destination; Sign out is pinned at the bottom of this sidebar.
*/
const LINKS: { href: string; label: string; built: boolean; icon: string }[] = [
  { href: "/", label: "Home", built: true, icon: "home" },
  { href: "/masters/customers", label: "Customer Master", built: true, icon: "customers" },
  { href: "/masters/gl", label: "GL Master", built: true, icon: "gl" },
  { href: "/invoices", label: "Sales Invoices", built: true, icon: "invoices" },
  { href: "/receipts", label: "Receipt Entry", built: true, icon: "receipts" },
  { href: "/upload", label: "Upload Report", built: true, icon: "upload" },
  { href: "/reminders", label: "AR Followup", built: true, icon: "reminders" },
  { href: "/reports/statement", label: "Customer Statement", built: true, icon: "statement" },
  { href: "/reports/ageing", label: "AR Ageing", built: true, icon: "ageing" },
  { href: "/cashflow", label: "Cashflow Projection", built: true, icon: "cashflow" },
  { href: "/access", label: "User & Access", built: true, icon: "access" },
  { href: "/dashboard", label: "Dashboard", built: true, icon: "dashboard" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  // Read after mount so the server-rendered HTML (no localStorage) matches.
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => setUsername(getSession()), []);

  function handleSignOut() {
    signOut();
    router.replace("/signin");
  }

  return (
    <nav className="flex h-full w-60 flex-col gap-1.5 border-r border-slate-200 bg-white p-4 print:hidden dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6 px-1">
        {/* Verve Advisory logo — blue in light mode, white in dark mode */}
        <img src="/verve-logo-blue.png" alt="Verve Advisory" className="h-16 w-auto dark:hidden" />
        <img src="/verve-logo-white.png" alt="Verve Advisory" className="hidden h-16 w-auto dark:block" />
        <h1 className="mt-3 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          AR Manager
        </h1>
      </div>
      {LINKS.map((l) => {
        const active = pathname === l.href;
        if (!l.built) {
          return (
            <span
              key={l.href}
              className="group flex cursor-default items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[13px] text-slate-400 transition-colors dark:text-slate-500"
            >
              <span className="flex items-center gap-2.5">
                <ScreenIcon name={l.icon} className="h-[18px] w-[18px] flex-none opacity-60" />
                {l.label}
              </span>
              <span className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 transition-transform duration-200 group-hover:scale-105 dark:bg-slate-800 dark:text-slate-500">
                build me
              </span>
            </span>
          );
        }
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200 ${
              active
                ? "bg-brand text-white shadow-sm"
                : "text-slate-700 hover:translate-x-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white/80" />
            )}
            <ScreenIcon
              name={l.icon}
              className="h-[18px] w-[18px] flex-none transition-transform duration-200 group-hover:scale-110"
            />
            {l.label}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-slate-200 pt-3 dark:border-slate-800">
        {username && (
          <div className="mb-1 flex items-center gap-2.5 px-3 py-1.5">
            <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand/10 text-xs font-semibold uppercase text-brand dark:bg-brand-300/15 dark:text-brand-300">
              {username[0]}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium capitalize text-slate-700 dark:text-slate-200">{username}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Signed in</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 transition-all duration-200 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <ScreenIcon
            name="signout"
            className="h-[18px] w-[18px] flex-none transition-transform duration-200 group-hover:scale-110"
          />
          Sign out
        </button>
      </div>
    </nav>
  );
}
