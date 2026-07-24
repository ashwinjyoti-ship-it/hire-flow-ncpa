import type { StickyNoteLayout } from "../../worker/lib/sticky-notes";

export const STICKY_CARD_WIDTH = 272;
export const STICKY_CARD_HEIGHT = 248;

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampStickyPosition(position: StickyNoteLayout): StickyNoteLayout {
  return {
    x: clampUnit(position.x),
    y: clampUnit(position.y),
    z_index: Math.min(100000, Math.max(0, Math.round(position.z_index))),
  };
}

export function autoStickyPosition(index: number): StickyNoteLayout {
  const column = index % 3;
  const row = Math.floor(index / 3) % 3;
  const page = Math.floor(index / 9);
  return {
    x: clampUnit(0.035 + column * 0.33 + page * 0.018),
    y: clampUnit(0.04 + row * 0.32 + page * 0.018),
    z_index: index + 1,
  };
}

export function stickyRotation(noteId: string): number {
  let hash = 0;
  for (const character of noteId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 31) - 15) / 10;
}

export function currentEventId(pathname: string): string | null {
  const match = /^\/events\/([^/]+)(?:\/(?:edit|meeting))?$/.exec(pathname);
  if (!match || match[1] === "new") return null;
  return decodeURIComponent(match[1]!);
}
