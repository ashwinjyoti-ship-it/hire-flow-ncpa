import { z } from "zod";

export const STICKY_NOTE_BODY_MAX = 1000;
export const STICKY_NOTE_LIST_LIMIT = 100;

export const StickyNoteCreateInput = z.object({
  body: z.string().trim().min(1).max(STICKY_NOTE_BODY_MAX),
  event_id: z.string().min(1).nullable().optional(),
  organisation_id: z.string().min(1).nullable().optional(),
  layout: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    z_index: z.number().int().min(0).max(100000).default(1),
  }).optional(),
});

export const StickyNoteEditInput = z.object({
  body: z.string().trim().min(1).max(STICKY_NOTE_BODY_MAX),
  expected_updated_at: z.string().min(1),
});

export const StickyNoteLinkInput = z.object({
  event_id: z.string().min(1).nullable().optional(),
  organisation_id: z.string().min(1).nullable().optional(),
});

export const StickyNoteLayoutInput = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  z_index: z.number().int().min(0).max(100000),
});

export type StickyNoteStatus = "active" | "archived";

export interface StickyNoteLayout {
  x: number;
  y: number;
  z_index: number;
}

export interface StickyNote {
  id: string;
  body: string;
  status: StickyNoteStatus;
  event_id: string | null;
  event_title: string | null;
  event_code: string | null;
  event_start_date: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  archived_by: string | null;
  archived_by_name: string | null;
  archived_at: string | null;
  layout: StickyNoteLayout | null;
}

export interface StickyNotesResponse {
  notes: StickyNote[];
  total: number;
  limit: number;
  offset: number;
}
