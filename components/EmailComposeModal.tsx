"use client";

import { useState } from "react";
import { FormField, inputClass } from "./FormField";

/*
  Composes an email and hands it to the user's own mail client via a mailto:
  link — this app has no email-sending backend (no SMTP/API keys, no server),
  so "send" always means "open a pre-filled draft for a human to review and
  send." `onSend` runs first, e.g. to download a report file the user should
  attach before hitting send in their mail client.
*/
export interface EmailComposeModalProps {
  title: string;
  defaultTo?: string;
  defaultCc?: string;
  defaultSubject: string;
  defaultBody: string;
  attachmentNote?: string;
  onSend?: () => void;
  onClose: () => void;
}

export function EmailComposeModal({
  title,
  defaultTo = "",
  defaultCc = "",
  defaultSubject,
  defaultBody,
  attachmentNote,
  onSend,
  onClose,
}: EmailComposeModalProps) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  function handleSend() {
    if (!to.trim()) return;
    onSend?.();
    const params = new URLSearchParams({ subject, body });
    if (cc.trim()) params.set("cc", cc.trim());
    window.location.href = `mailto:${to.trim()}?${params.toString()}`;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-brand dark:text-white">{title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Opens a draft in your own email app — nothing is sent from here.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <FormField label="To">
            <input
              type="text"
              className={inputClass}
              placeholder="name@company.com, another@company.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </FormField>
          <FormField label="CC (optional — comma-separate to loop in more people)">
            <input
              type="text"
              className={inputClass}
              placeholder="manager@company.com, sales@company.com"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </FormField>
          <FormField label="Subject">
            <input type="text" className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label="Message">
            <textarea
              className={`${inputClass} min-h-[140px] resize-y`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
        </div>

        {attachmentNote && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {attachmentNote}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!to.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Open in Mail App
          </button>
        </div>
      </div>
    </div>
  );
}
