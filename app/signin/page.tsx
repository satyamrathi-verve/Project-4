"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { checkLogin, signIn } from "@/lib/auth";
import { customerSignIn, customerSignUp } from "@/lib/customerAuth";
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

/* The authentic Microsoft four-square logo. */
function MicrosoftLogo() {
  return (
    <svg className="h-4 w-4 flex-none" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill="#f25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
      <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
      <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();

  // Internal login — unchanged from before, just now living behind a tab.
  const [tab, setTab] = useState<"internal" | "customer">("internal");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [msNote, setMsNote] = useState(false);

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

  function watchCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCapsOn(e.getModifierState && e.getModifierState("CapsLock"));
  }

  function fillDemo() {
    setUsername("admin");
    setPassword("admin123");
    setError(false);
  }

  // Customer login — real Supabase Auth (see lib/customerAuth.ts). Separate
  // state, separate submit handler, separate table entirely from the above.
  const [custMode, setCustMode] = useState<"login" | "signup">("login");
  const [custEmail, setCustEmail] = useState("");
  const [custPassword, setCustPassword] = useState("");
  const [custError, setCustError] = useState<string | null>(null);
  const [custNotice, setCustNotice] = useState<string | null>(null);
  const [custChecking, setCustChecking] = useState(false);

  async function handleCustomerSubmit(e: FormEvent) {
    e.preventDefault();
    if (custChecking) return;
    setCustChecking(true);
    setCustError(null);
    setCustNotice(null);

    const result = custMode === "login" ? await customerSignIn(custEmail, custPassword) : await customerSignUp(custEmail, custPassword);

    setCustChecking(false);

    if (result.error) {
      setCustError(result.error);
      return;
    }
    if (!result.hasSession) {
      setCustNotice("Account created — check your email to confirm it, then log in below.");
      setCustMode("login");
      setCustPassword("");
      return;
    }
    router.replace("/portal");
  }

  return (
    <div className="flex min-h-screen">
      {/* Brand panel — hidden on small screens, the story half of the split-screen */}
      <div className="relative hidden w-[45%] flex-none flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand to-brand-900 p-12 text-white dark:from-brand-900 dark:via-brand-950 dark:to-black lg:flex">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />

        <img src="/verve-logo-white.png" alt="Verve Advisory" className="relative h-10 w-auto self-start object-contain" />

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
                className="flex animate-fade-in-up items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur-sm transition-transform duration-200 hover:translate-x-1 hover:bg-white/15"
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

        <div className="relative w-full max-w-sm animate-fade-in-up">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <img src="/verve-logo-blue.png" alt="Verve Advisory" className="h-9 w-auto object-contain dark:hidden lg:hidden" />
            <img src="/verve-logo-white.png" alt="Verve Advisory" className="hidden h-9 w-auto object-contain dark:block lg:hidden" />
            <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-100 lg:mt-0">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tab === "internal" ? "Sign in to your Verve AR Manager account." : "Sign in to see your invoices and balance."}
            </p>
          </div>

          <div className="mt-6 flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setTab("internal")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === "internal" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Internal Login
            </button>
            <button
              type="button"
              onClick={() => setTab("customer")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === "customer" ? "bg-brand text-white" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Customer Login
            </button>
          </div>

          {tab === "internal" ? (
            <form onSubmit={handleSubmit}>
              {/* Microsoft SSO — visual only for the demo; nudges to the demo login */}
              <button
                type="button"
                onClick={() => setMsNote(true)}
                className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-400 hover:shadow active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
              >
                <MicrosoftLogo />
                Continue with Microsoft
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                  soon
                </span>
              </button>

              {msNote && (
                <p className="mt-3 animate-fade-in-up rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                  Microsoft sign-in arrives after the event — use the demo login below 👇
                </p>
              )}

              <div className="mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  or sign in with username
                </span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
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
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      className={`${inputClass} w-full pr-10`}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={watchCaps}
                      onKeyUp={watchCaps}
                      autoComplete="current-password"
                      aria-label="Password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-brand dark:hover:text-brand-300"
                    >
                      {showPw ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </FormField>
                {capsOn && (
                  <p className="animate-fade-in -mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                    ⇪ Caps Lock is on
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-4 animate-shake rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
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

              <button
                type="button"
                onClick={fillDemo}
                className="mx-auto mt-4 block text-center text-xs text-slate-400 transition-colors hover:text-brand dark:text-slate-500 dark:hover:text-brand-300 lg:mx-0 lg:text-left"
              >
                Demo: <span className="font-medium">admin / admin123</span> — click to fill
              </button>
            </form>
          ) : (
            <form onSubmit={handleCustomerSubmit}>
              <div className="mt-6 flex flex-col gap-4">
                <FormField label="Email">
                  <input
                    type="email"
                    className={inputClass}
                    value={custEmail}
                    onChange={(e) => setCustEmail(e.target.value)}
                    autoComplete="email"
                    aria-label="Email"
                    required
                  />
                </FormField>
                <FormField label="Password">
                  <input
                    type="password"
                    className={inputClass}
                    value={custPassword}
                    onChange={(e) => setCustPassword(e.target.value)}
                    autoComplete={custMode === "login" ? "current-password" : "new-password"}
                    aria-label="Password"
                    minLength={6}
                    required
                  />
                </FormField>
              </div>

              {custError && (
                <p
                  role="alert"
                  className="mt-4 animate-fade-in-up rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  {custError}
                </p>
              )}
              {custNotice && (
                <p className="mt-4 animate-fade-in-up rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {custNotice}
                </p>
              )}

              <button
                type="submit"
                disabled={custChecking}
                className="mt-6 w-full rounded-lg bg-gradient-to-r from-brand to-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:shadow-md hover:shadow-brand/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-sm"
              >
                {custChecking ? "Checking…" : custMode === "login" ? "Sign In →" : "Create account →"}
              </button>

              <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500 lg:text-left">
                {custMode === "login" ? (
                  <>
                    First time here?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setCustMode("signup");
                        setCustError(null);
                        setCustNotice(null);
                      }}
                      className="font-medium text-brand hover:underline dark:text-brand-300"
                    >
                      Set up your password
                    </button>
                  </>
                ) : (
                  <>
                    Already set up?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setCustMode("login");
                        setCustError(null);
                        setCustNotice(null);
                      }}
                      className="font-medium text-brand hover:underline dark:text-brand-300"
                    >
                      Sign in instead
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
