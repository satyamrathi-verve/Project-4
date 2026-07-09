"use client";

import { useEffect, useState } from "react";

interface AttachmentItem {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

const MAX_FILE_BYTES = 3 * 1024 * 1024; // sessionStorage has a small total quota, so cap per file

export function attachmentsStorageKey(invoiceId: string) {
  return `invoice-attachments:${invoiceId}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/*
  Demo-only attachments: there's no Supabase Storage bucket (or any file table)
  wired up, so nothing here reaches the backend. Files are read as data URLs and
  kept in this browser tab's sessionStorage, keyed by invoice id — good enough to
  click through Upload/View/Delete for a demo, gone on refresh or in another tab.
*/
export function Attachments({ invoiceId }: { invoiceId: string }) {
  const [files, setFiles] = useState<AttachmentItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(attachmentsStorageKey(invoiceId));
    if (!raw) {
      setFiles([]);
      return;
    }
    try {
      setFiles(JSON.parse(raw));
    } catch {
      setFiles([]);
    }
  }, [invoiceId]);

  function persist(next: AttachmentItem[]) {
    setFiles(next);
    try {
      sessionStorage.setItem(attachmentsStorageKey(invoiceId), JSON.stringify(next));
    } catch {
      setError("Couldn't save that attachment — this browser tab's storage is full. Try a smaller file.");
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const incoming = Array.from(fileList);

    const reads = incoming.map(
      (file) =>
        new Promise<AttachmentItem | null>((resolve) => {
          if (file.size > MAX_FILE_BYTES) {
            setError(`"${file.name}" is too large for this demo (max 3 MB).`);
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: reader.result as string,
            });
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        })
    );

    Promise.all(reads).then((results) => {
      const valid = results.filter((r): r is AttachmentItem => r !== null);
      if (valid.length > 0) persist([...files, ...valid]);
    });
  }

  function removeFile(id: string) {
    persist(files.filter((f) => f.id !== id));
  }

  return (
    <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Attachments</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Demo only — kept in this browser tab for now, not saved to the server.</p>
        </div>
        <label className="flex-none cursor-pointer rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand-50 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-brand-900/20">
          + Upload
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {files.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No attachments yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {f.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.dataUrl} alt={f.name} className="h-12 w-12 flex-none rounded object-cover" />
              ) : (
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  FILE
                </div>
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={f.dataUrl}
                  download={f.name}
                  className="block truncate text-sm font-medium text-brand hover:underline dark:text-brand-300"
                >
                  {f.name}
                </a>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatSize(f.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="flex-none text-red-600 hover:underline dark:text-red-400"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
