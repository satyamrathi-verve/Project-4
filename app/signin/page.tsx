"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkLogin, signIn } from "@/lib/auth";
import { FormField, inputClass } from "@/components/FormField";

export default function SignInPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (checkLogin(username, password)) {
      signIn(username);
      setError(false);
      router.replace("/");
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Sign in to AR Manager</h1>
        <p className="mt-1 text-sm text-slate-500">Use your demo login to continue.</p>

        <div className="mt-6 flex flex-col gap-4">
          <FormField label="Username">
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="Password">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            That username or password isn&apos;t right. Try again.
          </p>
        )}

        <button
          type="submit"
          className="mt-6 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Sign In
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          Demo login: <span className="font-medium text-slate-500">admin / admin123</span>
        </p>
      </form>
    </div>
  );
}
