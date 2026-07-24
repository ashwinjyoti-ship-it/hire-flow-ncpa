import { useEffect, useRef } from "react";
import { STICKY_NOTE_BODY_MAX } from "../../../worker/lib/sticky-notes";
import { StickyNoteLinkPicker, type StickyNoteLinkValue } from "./StickyNoteLinkPicker";

type StickyNoteComposerProps = {
  body: string;
  link: StickyNoteLinkValue | null;
  pending: boolean;
  error: string | null;
  onBodyChange: (body: string) => void;
  onLinkChange: (link: StickyNoteLinkValue | null) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function StickyNoteComposer({
  body,
  link,
  pending,
  error,
  onBodyChange,
  onLinkChange,
  onSave,
  onCancel,
}: StickyNoteComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <section className="sticky-paper relative flex h-[248px] w-[272px] flex-col p-4" aria-label="New sticky note">
      <div className="sticky-pin" aria-hidden="true" />
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSave();
          }
        }}
        maxLength={STICKY_NOTE_BODY_MAX}
        placeholder="Write the client instruction…"
        aria-label="Sticky note text"
        className="font-hand min-h-0 flex-1 resize-none bg-transparent pt-2 text-[21px] leading-6 text-[#433c2d] outline-none placeholder:text-[#7c7158]/60"
      />
      <StickyNoteLinkPicker value={link} onChange={onLinkChange} compact />
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[#6e624a]">
        <span>{body.length}/{STICKY_NOTE_BODY_MAX}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onCancel} className="rounded-lg bg-black/5 px-2 py-1 font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!body.trim() || pending}
            className="rounded-lg bg-[#78622e] px-2.5 py-1 font-semibold text-[#fff9df] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Stick it"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-[10px] font-semibold text-[#9c3f32]">{error}</p>}
    </section>
  );
}
