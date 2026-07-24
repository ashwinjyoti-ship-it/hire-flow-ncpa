import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { StickyNote, StickyNoteLayout } from "../../../worker/lib/sticky-notes";
import { formatDateTime } from "../../lib/use-lookups";
import {
  clampStickyPosition,
  stickyRotation,
  STICKY_CARD_HEIGHT,
  STICKY_CARD_WIDTH,
} from "../../lib/sticky-notes";
import { StickyNoteLinkPicker, type StickyNoteLinkValue } from "./StickyNoteLinkPicker";

type StickyNoteCardProps = {
  note: StickyNote;
  currentUserId: string;
  position: StickyNoteLayout;
  canvasSize: { width: number; height: number };
  mobile: boolean;
  onBringFront: (noteId: string) => number;
  onMove: (noteId: string, position: StickyNoteLayout) => void;
  onEdit: (note: StickyNote, body: string) => Promise<void>;
  onRelink: (noteId: string, link: StickyNoteLinkValue | null) => Promise<void>;
  onArchive: (noteId: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
  onOpenEvent: (eventId: string) => void;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: StickyNoteLayout;
};

export function StickyNoteCard({
  note,
  currentUserId,
  position,
  canvasSize,
  mobile,
  onBringFront,
  onMove,
  onEdit,
  onRelink,
  onArchive,
  onDelete,
  onOpenEvent,
}: StickyNoteCardProps) {
  const dragRef = useRef<DragState | null>(null);
  const livePositionRef = useRef<StickyNoteLayout | null>(null);
  const [livePosition, setLivePosition] = useState<StickyNoteLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const displayedPosition = livePosition ?? position;
  const isCreator = note.created_by === currentUserId;
  const link: StickyNoteLinkValue | null = note.event_id || note.organisation_id
    ? {
        event_id: note.event_id,
        event_title: note.event_title,
        organisation_id: note.organisation_id,
        organisation_name: note.organisation_name,
      }
    : null;

  const availableWidth = Math.max(canvasSize.width - STICKY_CARD_WIDTH, 1);
  const availableHeight = Math.max(canvasSize.height - STICKY_CARD_HEIGHT, 1);
  const cardStyle: CSSProperties | undefined = mobile
    ? undefined
    : {
        left: displayedPosition.x * availableWidth,
        top: displayedPosition.y * availableHeight,
        zIndex: displayedPosition.z_index,
        transform: `rotate(${stickyRotation(note.id)}deg)`,
      };

  function beginDrag(event: PointerEvent<HTMLButtonElement>) {
    if (mobile) return;
    event.preventDefault();
    const zIndex = onBringFront(note.id);
    const startPosition = { ...displayedPosition, z_index: zIndex };
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition,
    };
    livePositionRef.current = startPosition;
    setLivePosition(startPosition);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampStickyPosition({
      x: drag.startPosition.x + (event.clientX - drag.startClientX) / availableWidth,
      y: drag.startPosition.y + (event.clientY - drag.startClientY) / availableHeight,
      z_index: drag.startPosition.z_index,
    });
    livePositionRef.current = next;
    setLivePosition(next);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finalPosition = livePositionRef.current ?? drag.startPosition;
    dragRef.current = null;
    livePositionRef.current = null;
    onMove(note.id, finalPosition);
    setLivePosition(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 0.1 : 0.025;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key] as [number, number] | undefined;
    if (!delta) return;
    event.preventDefault();
    const next = clampStickyPosition({
      x: position.x + delta[0],
      y: position.y + delta[1],
      z_index: onBringFront(note.id),
    });
    onMove(note.id, next);
  }

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
    <article
      className={`${mobile ? "relative mx-auto shrink-0" : "absolute"} sticky-paper flex h-[248px] w-[272px] flex-col p-4`}
      style={cardStyle}
      aria-label={`Sticky note by ${note.created_by_name}`}
    >
      <div className="sticky-pin" aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 pt-1">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#6d6047]">
          {note.created_by_name}
        </p>
        <button
          type="button"
          onPointerDown={beginDrag}
          onPointerMove={continueDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onKeyDown={moveWithKeyboard}
          aria-label="Move note; use arrow keys for precise movement"
          title={mobile ? "Notes auto-arrange on this screen size" : "Drag to move · arrow keys for precision"}
          className="sticky-drag-handle -mr-1 -mt-1 rounded px-1.5 py-0.5 text-xs text-[#76694e] focus:outline-none focus:ring-2 focus:ring-[#8b6a36]/40"
        >
          ⠿
        </button>
      </div>

      {editing ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col">
          <textarea
            autoFocus
            value={body}
            maxLength={1000}
            onChange={(event) => setBody(event.target.value)}
            className="font-hand min-h-0 flex-1 resize-none bg-white/20 px-1 text-[20px] leading-6 text-[#433c2d] outline-none"
          />
          <div className="mt-1 flex justify-end gap-1.5 text-[10px]">
            <button type="button" onClick={() => { setBody(note.body); setEditing(false); }} className="rounded bg-black/5 px-2 py-1">
              Cancel
            </button>
            <button
              type="button"
              disabled={!body.trim() || busy}
              onClick={() => run(async () => {
                await onEdit(note, body);
                setEditing(false);
              })}
              className="rounded bg-[#78622e] px-2 py-1 font-semibold text-[#fff9df] disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="font-hand mt-1 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words pr-1 text-[21px] leading-6 text-[#433c2d]">
          {note.body}
        </p>
      )}

      {linking ? (
        <div className="mt-1">
          <StickyNoteLinkPicker
            value={link}
            onChange={(next) => run(async () => {
              await onRelink(note.id, next);
              setLinking(false);
            })}
            compact
          />
        </div>
      ) : link ? (
        <button
          type="button"
          onClick={() => note.event_id ? onOpenEvent(note.event_id) : setLinking(true)}
          className="mt-1 truncate rounded-lg bg-black/5 px-2 py-1 text-left text-[10px] font-semibold text-[#66583d] hover:bg-black/10"
          title={note.event_id ? "Open linked event form" : "Change linked organisation"}
        >
          {note.event_title ?? note.organisation_name}
          {note.event_title && note.organisation_name ? ` · ${note.organisation_name}` : ""}
        </button>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-1 border-t border-black/10 pt-1.5 text-[10px] text-[#6e624a]">
        <span className="truncate" title={formatDateTime(note.created_at)}>{formatDateTime(note.created_at)}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(note.body)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                })
                .catch(() => setError("Clipboard access was blocked."));
            }}
            className="rounded bg-black/5 px-1.5 py-1 font-semibold"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => setLinking((open) => !open)} className="rounded bg-black/5 px-1.5 py-1 font-semibold">
            Link
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onArchive(note.id))}
            className="rounded bg-[#687548] px-1.5 py-1 font-semibold text-white disabled:opacity-50"
          >
            Incorporated
          </button>
          {isCreator && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded bg-black/5 px-1.5 py-1 font-bold" aria-label="Creator actions">•••</summary>
              <div className="absolute bottom-7 right-0 z-[130] w-24 rounded-lg bg-[#fff9df] p-1 shadow-xl">
                <button type="button" onClick={() => setEditing(true)} className="block w-full rounded px-2 py-1 text-left hover:bg-black/5">Edit</button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Permanently delete this sticky note? It will not remain in history.")) {
                      void run(() => onDelete(note.id));
                    }
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-[#9c3f32] hover:bg-black/5"
                >
                  Delete
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-1 truncate text-[10px] font-semibold text-[#9c3f32]" title={error}>{error}</p>}
    </article>
  );
}
