"use client";

import { useEffect, useRef, useState } from "react";
import { getSession } from "@/lib/auth";

/*
  Aria — the AR Intelligent Assistant. A floating chat button (bottom-right,
  every screen) that opens a slide-in panel, modeled on assistants like Zoho's
  "Ask Zia". Questions go to /api/chat, which answers instantly from the live
  Supabase books via the scripted engine in lib/arQuery.ts.
*/

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  mode?: "ai" | "scripted";
}

const SUGGESTIONS = [
  "What's our total outstanding?",
  "Who should we chase first?",
  "Show the ageing summary",
  "What's expected this month?",
  "Anyone over their credit limit?",
  "How much does Nimbus owe?",
];

function AriaAvatar({ size = "h-9 w-9" }: { size?: string }) {
  return (
    <span className={`flex ${size} flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-400 text-white shadow-sm`}>
      <svg className="h-[55%] w-[55%]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
    </span>
  );
}

export function AskAria() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const session = getSession();
    if (session) setUserName(session.charAt(0).toUpperCase() + session.slice(1));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 320);
  }, [open]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: q }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer ?? data.error ?? "Something went wrong — try again.", mode: data.mode },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach the server — check the dev server and try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Ask Aria"
        aria-label="Ask Aria — your AR assistant"
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-600 text-white shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl active:scale-95 print:hidden ${
          open ? "scale-0 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
        </svg>
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-accent dark:border-slate-900" />
        </span>
      </button>

      {/* Slide-in panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-slate-800 dark:bg-slate-900 print:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-label="Aria — AR assistant"
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <AriaAvatar />
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Ask Aria</h2>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand dark:bg-brand-900/40 dark:text-brand-300">
              Beta
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Aria"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col">
              <div className="flex items-start gap-3">
                <AriaAvatar size="h-8 w-8" />
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Hi {userName ?? "there"},</p>
                  <h3 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-white">How can I assist you today?</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    I answer anything about your <b className="font-semibold text-slate-700 dark:text-slate-200">receivables</b> — outstanding
                    balances, <b className="font-semibold text-slate-700 dark:text-slate-200">overdue invoices</b>, ageing, expected cash,
                    credit limits, and any <b className="font-semibold text-slate-700 dark:text-slate-200">customer, invoice or receipt</b> —
                    straight from the live books.
                  </p>
                </div>
              </div>

              <div className="mt-auto pt-6">
                <p className="mb-2 text-right text-xs font-medium text-slate-400 dark:text-slate-500">Need a quick start? Try these!</p>
                <div className="flex flex-wrap justify-end gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-400 dark:hover:text-brand-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-white">{m.text}</p>
                  </div>
                ) : (
                  <div key={i} className="flex items-end gap-2">
                    <AriaAvatar size="h-6 w-6" />
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {m.text}
                    </p>
                  </div>
                )
              )}
              {busy && (
                <div className="flex items-end gap-2">
                  <AriaAvatar size="h-6 w-6" />
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 dark:bg-slate-800">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex-none border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your query"
              aria-label="Ask Aria a question"
              className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-400"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand text-white transition-all duration-150 hover:bg-brand-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </button>
          </form>
          <p className="mt-2 text-center text-[10px] text-slate-400 dark:text-slate-500">
            Aria answers from your live books — instant, offline-safe, always in sync with the dashboard.
          </p>
        </div>
      </div>
    </>
  );
}
