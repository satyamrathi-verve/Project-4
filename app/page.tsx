import Link from "next/link";
import { isConfigured } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { NotConfigured } from "@/components/NotConfigured";
import { CopyButton } from "@/components/CopyButton";
import { ScreenIcon } from "@/components/icons";

/*
  The home / "start here" screen. Nothing in this app is pre-built — your team
  builds every screen on the roadmap below. This page welcomes you, tracks how many
  screens are done, and hands you the prompt to paste into Claude Code. Once you've
  built the Dashboard, you can point this page there (or replace it with the dashboard).

  As you finish a screen, flip its `built` to true — the progress bar and its card
  update automatically.
*/
const ROADMAP: { icon: string; title: string; desc: string; built: boolean }[] = [
  { icon: "signin", title: "Sign In", desc: "A front-door login gate", built: true },
  { icon: "customers", title: "Customer Master", desc: "List customers, add / edit one", built: true },
  { icon: "gl", title: "GL Master", desc: "The ledger accounts list", built: true },
  { icon: "invoices", title: "Sales Invoice — List", desc: "Search + filter by status", built: true },
  { icon: "invoices", title: "Sales Invoice — View", desc: "Read-only invoice detail", built: true },
  { icon: "invoices", title: "Sales Invoice — Punch", desc: "Create or edit an invoice", built: true },
  { icon: "invoices", title: "Invoice Print Preview", desc: "A clean, printable page", built: true },
  { icon: "receipts", title: "Receipt Entry", desc: "Record money, knock off invoices", built: true },
  { icon: "upload", title: "Upload Report", desc: "Bulk import from a CSV", built: true },
  { icon: "reminders", title: "Reminder Template", desc: "The chaser email you send", built: true },
  { icon: "reminders", title: "Auto Email Shoot", desc: "Chase every overdue customer", built: true },
  { icon: "statement", title: "Customer Statement", desc: "A running ledger per customer", built: true },
  { icon: "ageing", title: "AR Ageing", desc: "Outstanding split into age buckets", built: true },
  { icon: "cashflow", title: "Cashflow Projection", desc: "Expected collections, week by week", built: true },
  { icon: "dashboard", title: "Dashboard", desc: "At-a-glance overview tiles", built: true },
];

const STEPS = [
  "The database and all its data already exist in Supabase — you never touch the backend.",
  "Point Claude Code at a screen from the list; it writes the page, you tweak it in plain English.",
  "When a screen works, commit & push — that scores your team on the live leaderboard.",
];

export default function HomePage() {
  const built = ROADMAP.filter((r) => r.built).length;
  const total = ROADMAP.length;
  const pct = Math.round((built / total) * 100);
  const nextScreen = ROADMAP.find((r) => !r.built);
  const dashboardBuilt = ROADMAP.find((r) => r.title === "Dashboard")?.built ?? false;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="animate-fade-in-up">
        <PageHeader
          title="Welcome — let's build the AR Manager"
          subtitle="Nothing here is pre-built. You build every screen, one at a time."
        />
      </div>

      {dashboardBuilt && (
        <div className="mb-6 animate-fade-in-up rounded-xl border border-brand/30 bg-gradient-to-r from-brand to-brand-700 p-6 text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-100">Live now</p>
              <h3 className="mt-1 text-xl font-bold">See the whole business at a glance</h3>
              <p className="mt-1 text-sm text-brand-100">Customers, invoices, overdue risk, and cash collected — all on one screen.</p>
            </div>
            <Link
              href="/dashboard"
              className="flex-none rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              Open Dashboard →
            </Link>
          </div>
        </div>
      )}

      {!isConfigured && (
        <div className="mb-6 animate-fade-in-up">
          <NotConfigured />
        </div>
      )}

      {/* Progress + next-up */}
      <div className="grid animate-fade-in-up gap-6 border-b border-slate-200 pb-8 dark:border-slate-800 md:grid-cols-3" style={{ animationDelay: "60ms" }}>
        <div className="md:col-span-2">
          <div className="flex items-end justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Build progress
            </h3>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              <span className="text-2xl font-bold text-brand dark:text-brand-300">{built}</span> / {total} screens
            </p>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-brand to-brand-400"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {built === 0
              ? "Fresh start — build the first screen and watch this fill up."
              : built === total
              ? "All screens built. Time to demo!"
              : `Nice — ${total - built} to go. Keep pushing after each one.`}
          </p>
        </div>

        {nextScreen && (
          <div className="group flex flex-col justify-between border-l-2 border-brand pl-4 dark:border-brand-400">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-300">Next up</p>
              <div className="mt-2 flex items-center gap-2">
                <ScreenIcon name={nextScreen.icon} className="h-5 w-5 flex-none text-brand dark:text-brand-300" />
                <h4 className="font-bold text-slate-900 dark:text-white">{nextScreen.title}</h4>
              </div>
            </div>
            <div className="mt-3">
              <CopyButton text={`build the ${nextScreen.title} screen`} label="Copy prompt" />
            </div>
          </div>
        )}
      </div>

      {/* How this works */}
      <div className="mt-8 animate-fade-in-up" style={{ animationDelay: "120ms" }}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          How this works
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {i + 1}
              </span>
              <p className="text-sm text-slate-600 dark:text-slate-300">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The roadmap grid */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            The screens to build
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Spine first — a few done well beats all half-broken.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map((r, i) => (
            <div
              key={r.title}
              className="group animate-fade-in-up rounded-lg p-4 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              style={{ animationDelay: `${150 + i * 35}ms` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-white dark:bg-brand-900/40 dark:text-brand-300">
                  <ScreenIcon name={r.icon} className="h-5 w-5" />
                </div>
                {r.built ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Done
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                    Build me
                  </span>
                )}
              </div>
              <h4 className="mt-3 flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">{i + 1}.</span>
                {r.title}
              </h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 animate-fade-in text-center text-sm text-slate-500 dark:text-slate-400" style={{ animationDelay: "700ms" }}>
        Ready? Tell Claude Code: <span className="font-medium text-slate-700 dark:text-slate-200">&ldquo;build the Sign In screen.&rdquo;</span>
      </p>
    </div>
  );
}
