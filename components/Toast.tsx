"use client";

import { useEffect, useState } from "react";

/*
  A tiny app-wide toast system with no dependencies. Fire one from anywhere:

    import { toast } from "@/components/Toast";
    toast("Invoice INV-0001 deleted");            // success (default)
    toast("Couldn't save", "error");

  <Toaster /> is mounted once in AuthGate; toasts stack bottom-left (Aria owns
  the bottom-right corner), slide in, and auto-dismiss after 3.5s.
*/

type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, type } }));
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  leaving?: boolean;
}

const ACCENT: Record<ToastType, string> = {
  success: "border-emerald-500",
  error: "border-red-500",
  info: "border-brand",
};

const ICON: Record<ToastType, JSX.Element> = {
  success: (
    <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  info: (
    <svg className="h-4 w-4 text-brand dark:text-brand-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  ),
};

let nextId = 1;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      const id = nextId++;
      setItems((list) => [...list, { id, message, type }]);
      setTimeout(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3200);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3600);
    }
    window.addEventListener("app-toast", onToast);
    return () => window.removeEventListener("app-toast", onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-[60] flex flex-col gap-2 print:hidden">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 rounded-lg border-l-4 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-lg transition-all duration-300 dark:bg-slate-800 dark:text-slate-200 ${ACCENT[t.type]} ${
            t.leaving ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
          }`}
          style={{ animation: "reveal-up 0.25s ease-out both" }}
          role="status"
        >
          {ICON[t.type]}
          <span className="max-w-xs">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
