/** Minimal toast system for the Organisations page.
 *
 * No portal: a single fixed, bottom-centred `role="status"` region. The hook
 * keeps a queue of 1 (newest replaces). Mirrors the `role="alert"` banner idiom
 * already used in EventEditPage.tsx but transient.
 *
 * Also provides localStorage-backed 30-day dismissal for banner cards, since the
 * spec says "Logged — we'll hide for 30 days". */
import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "org_banner_dismissed";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type ToastMsg = { id: number; text: string };

/** Render the toast region. Place once near the page root. */
export function ToastRegion({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="carved-card fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-marble-highlight px-5 py-2.5 text-sm text-ink-primary etched-deep"
    >
      {toast.text}
    </div>
  );
}

/** Imperative-ish toast + dismiss helpers. */
export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const show = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  return { toast, show };
}

/** Read the dismissed-id set, dropping any whose 30-day TTL has expired. */
function readDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const live: Record<string, number> = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && now - ts < TTL_MS) live[k] = ts;
    }
    return live;
  } catch {
    return {};
  }
}

/** Mark an id as dismissed for 30 days from now. */
export function dismissId(id: string) {
  try {
    const live = readDismissed();
    live[id] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(live));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

/** True iff `id` is currently within its 30-day dismissal window. */
export function isDismissed(id: string): boolean {
  return id in readDismissed();
}
