import { useState } from "react";
import type { StickyNote } from "../../../worker/lib/sticky-notes";
import { formatDateTime } from "../../lib/use-lookups";

type StickyNoteHistoryCardProps = {
  note: StickyNote;
  currentUserId: string;
  onRestore: (noteId: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
  onOpenEvent: (eventId: string) => void;
};

export function StickyNoteHistoryCard({
  note,
  currentUserId,
  onRestore,
  onDelete,
  onOpenEvent,
}: StickyNoteHistoryCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreator = note.created_by === currentUserId;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The note could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl bg-marble-highlight/75 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-hand whitespace-pre-wrap break-words text-xl leading-6 text-ink-primary">{note.body}</p>
          {(note.event_title || note.organisation_name) && (
            <button
              type="button"
              disabled={!note.event_id}
              onClick={() => note.event_id && onOpenEvent(note.event_id)}
              className="mt-2 rounded-full bg-sage-btn px-2.5 py-1 text-[11px] font-semibold text-sage-text disabled:cursor-default"
            >
              {note.event_title ?? note.organisation_name}
              {note.event_title && note.organisation_name ? ` · ${note.organisation_name}` : ""}
            </button>
          )}
          <p className="mt-2 text-[11px] text-ink-muted">
            Created by {note.created_by_name} · {formatDateTime(note.created_at)}
          </p>
          <p className="text-[11px] text-sage">
            Incorporated by {note.archived_by_name ?? "Team member"} · {note.archived_at ? formatDateTime(note.archived_at) : "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(note.body).catch(() => setError("Clipboard access was blocked."))}
            className="rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-semibold text-ink-secondary"
          >
            Copy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onRestore(note.id))}
            className="rounded-full bg-sage-btn px-3 py-1.5 text-xs font-semibold text-sage-text disabled:opacity-50"
          >
            Restore
          </button>
          {isCreator && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Permanently delete this archived note?")) {
                  void run(() => onDelete(note.id));
                }
              }}
              className="rounded-full bg-terracotta-btn px-3 py-1.5 text-xs font-semibold text-terracotta-text disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-status-cancelled">{error}</p>}
    </article>
  );
}
