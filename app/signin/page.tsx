"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkLogin, signIn } from "@/lib/auth";
import { FormField, inputClass } from "@/components/FormField";
import { ScreenIcon } from "@/components/icons";

const HIGHLIGHTS = [
  { icon: "ageing", text: "Know exactly who owes you, and for how long" },
  { icon: "cashflow", text: "See cash coming in before it lands" },
  { icon: "dashboard", text: "One screen for the whole business" },
];

// Real contributors from the team's commit history. `photo` is left blank until
// real pictures land in /public/team — set it to show the photo instead of initials.
const TEAM: { name: string; initials: string; photo?: string }[] = [
  { name: "Ansari Matiullah", initials: "AM" },
  { name: "Pranay Oswal", initials: "PO" },
  { name: "Prem Duseja", initials: "PD" },
  { name: "Prashant", initials: "PR" },
  { name: "Shubham Dhanawade", initials: "SD" },
  { name: "Sima Jain", initials: "SJ" },
];

function TeamAvatar({ member }: { member: (typeof TEAM)[number] }) {
  if (member.photo) {
    return (
      <img
        src={member.photo}
        alt={member.name}
        title={member.name}
        className="h-9 w-9 flex-none rounded-full border-2 border-brand object-cover ring-2 ring-white/20"
      />
    );
  }
  return (
    <div
      title={member.name}
      className="flex h-9 w-9 flex-none items-center justify-center rounded-full border-2 border-white/30 bg-white/15 text-xs font-semibold text-white ring-2 ring-white/10 backdrop-blur-sm"
    >
      {member.initials}
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;

    setChecking(true);
    setError(false);

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Small delay so the disabled/checking state is visible even though the check itself is instant.
    setTimeout(() => {
      if (checkLogin(trimmedUsername, trimmedPassword)) {
        signIn(trimmedUsername);
        router.replace("/");
      } else {
        setError(true);
        setChecking(false);
      }
    }, 300);
  }

  return (
    <div className="flex min-h-screen">
      {/* Brand panel — hidden on small screens, the story half of the split-screen */}
      <div className="relative hidden w-[45%] flex-none flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand to-brand-900 p-12 text-white dark:from-brand-900 dark:via-brand-950 dark:to-black lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />

        <img src="/verve-logo-white.png" alt="Verve Advisory" className="relative h-8 w-auto self-start" />

        <div className="relative animate-fade-in-up">
          <h1 className="text-3xl font-bold leading-tight">Take control of your receivables.</h1>
          <p className="mt-3 max-w-sm text-sm text-brand-100">
            Track outstanding balances, chase overdue invoices, and see your cash flow —
            all in one place, built screen by screen by your team.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {HIGHLIGHTS.map((h, i) => (
              <div
                key={h.text}
                className="flex animate-fade-in-up items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur-sm"
                style={{ animationDelay: `${120 + i * 90}ms` }}
              >
                <ScreenIcon name={h.icon} className="h-5 w-5 flex-none text-white" />
                <span className="text-sm text-white">{h.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative animate-fade-in-up" style={{ animationDelay: "420ms" }}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-200">Built live by the team</p>
          <div className="flex -space-x-2">
            {TEAM.map((member) => (
              <TeamAvatar key={member.name} member={member} />
            ))}
          </div>
          <p className="mt-3 text-xs text-brand-200">Verve AR Manager — built screen by screen, live.</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-gradient-to-b from-brand-50 to-white px-4 dark:from-brand-950 dark:to-slate-950 lg:bg-none lg:dark:bg-none">
        <div className="pointer-events-none absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl dark:bg-brand-700/20 lg:hidden" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-accent/20 blur-3xl dark:bg-accent/10 lg:hidden" />

        <form
          onSubmit={handleSubmit}
          className="relative w-full max-w-sm animate-fade-in-up rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-brand-900/10 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90 lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none dark:lg:bg-transparent"
        >
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <img src="/verve-logo-blue.png" alt="Verve Advisory" className="h-8 w-auto dark:hidden lg:hidden" />
            <img src="/verve-logo-white.png" alt="Verve Advisory" className="hidden h-8 w-auto dark:block lg:hidden" />
            <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-slate-100 lg:mt-0">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to pick up right where the team left off.</p>
          </div>

          <div className="mt-6 flex flex-col gap-4">
            <FormField label="Username">
              <input
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                aria-label="Username"
              />
            </FormField>
            <FormField label="Password">
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-label="Password"
              />
            </FormField>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 animate-fade-in-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              That username or password isn&apos;t right. Try again.
            </p>
          )}

          <button
            type="submit"
            disabled={checking}
            className="mt-6 w-full rounded-lg bg-gradient-to-r from-brand to-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:shadow-md hover:shadow-brand/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-sm"
          >
            {checking ? "Checking…" : "Sign In →"}
          </button>

          <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500 lg:text-left">
            Demo: <span className="font-medium text-slate-500 dark:text-slate-400">admin / admin123</span>
          </p>
        </form>
      </div>
    </div>
  );
}
