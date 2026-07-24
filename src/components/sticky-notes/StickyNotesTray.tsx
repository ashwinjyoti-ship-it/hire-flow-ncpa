import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { StickyNote, StickyNoteLayout, StickyNotesResponse } from "../../../worker/lib/sticky-notes";
import { useAuth } from "../../lib/auth";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../lib/api";
import {
  autoStickyPosition,
  clampUnit,
  STICKY_CARD_HEIGHT,
  STICKY_CARD_WIDTH,
} from "../../lib/sticky-notes";
import { StickyNoteCard } from "./StickyNoteCard";
import { StickyNoteComposer } from "./StickyNoteComposer";
import { StickyNoteHistoryCard } from "./StickyNoteHistoryCard";
import type { StickyNoteLinkValue } from "./StickyNoteLinkPicker";

type StickyNotesTrayProps = {
  open: boolean;
  onClose: () => void;
};

type NotePerson = { id: string; name: string };
type Tab = "active" | "history";

const DEFAULT_COMPOSER_POSITION: StickyNoteLayout = { x: 0.68, y: 0.05, z_index: 100 };

function useSmallCorkboard(): boolean {
  const [small, setSmall] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setSmall(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return small;
}

function noteMatches(note: StickyNote, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    note.body,
    note.event_title,
    note.event_code,
    note.organisation_name,
    note.created_by_name,
  ].some((value) => value?.toLowerCase().includes(term));
}

export function StickyNotesTray({ open, onClose }: StickyNotesTrayProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const highestZRef = useRef(100);
  const mobile = useSmallCorkboard();
  const [tab, setTab] = useState<Tab>("active");
  const [activeSearch, setActiveSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [archiverFilter, setArchiverFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 650 });
  const [positionOverrides, setPositionOverrides] = useState<Record<string, StickyNoteLayout>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [draftLink, setDraftLink] = useState<StickyNoteLinkValue | null>(null);
  const [composerPosition, setComposerPosition] = useState(DEFAULT_COMPOSER_POSITION);
  const [boardError, setBoardError] = useState<string | null>(null);
  const activeQuery = useQuery({
    queryKey: ["sticky-notes", "active"],
    queryFn: () => apiGet<StickyNotesResponse>("/sticky-notes?status=active&limit=100"),
    enabled: open && tab === "active",
    refetchInterval: open && tab === "active" ? 15_000 : false,
    staleTime: 0,
  });

  const historyParams = useMemo(() => {
    const params = new URLSearchParams({
      status: "archived",
      limit: "50",
      offset: String(historyPage * 50),
    });
    if (debouncedHistorySearch) params.set("q", debouncedHistorySearch);
    if (creatorFilter) params.set("created_by", creatorFilter);
    if (archiverFilter) params.set("archived_by", archiverFilter);
    if (fromFilter) params.set("from", fromFilter);
    if (toFilter) params.set("to", toFilter);
    return params.toString();
  }, [archiverFilter, creatorFilter, debouncedHistorySearch, fromFilter, historyPage, toFilter]);

  const historyQuery = useQuery({
    queryKey: ["sticky-notes", "history", historyParams],
    queryFn: () => apiGet<StickyNotesResponse>(`/sticky-notes?${historyParams}`),
    enabled: open && tab === "history",
    staleTime: 0,
  });

  const peopleQuery = useQuery({
    queryKey: ["sticky-notes", "people"],
    queryFn: () => apiGet<{ people: NotePerson[] }>("/sticky-notes/people"),
    enabled: open && tab === "history",
  });

  const createMutation = useMutation({
    mutationFn: () => apiPost("/sticky-notes", {
      body: draftBody,
      event_id: draftLink?.event_id ?? null,
      organisation_id: draftLink?.event_id ? null : draftLink?.organisation_id ?? null,
      layout: composerPosition,
    }),
    onSuccess: async () => {
      setDraftBody("");
      setDraftLink(null);
      setComposerOpen(false);
      await refreshNotes();
    },
  });

  async function refreshNotes() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sticky-notes"] }),
      queryClient.invalidateQueries({ queryKey: ["sticky-note-summary"] }),
    ]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedHistorySearch(historySearch.trim());
      setHistoryPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [historySearch]);

  useEffect(() => {
    setHistoryPage(0);
  }, [creatorFilter, archiverFilter, fromFilter, toFilter]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || tab !== "active" || !canvasRef.current) return;
    const element = canvasRef.current;
    const update = () => setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, tab]);

  const allActiveNotes = activeQuery.data?.notes ?? [];
  const activeNotes = allActiveNotes.filter((note) => noteMatches(note, activeSearch));
  const highestServerZ = allActiveNotes.reduce(
    (highest, note, index) => Math.max(highest, positionOverrides[note.id]?.z_index ?? note.layout?.z_index ?? index + 1),
    0,
  );
  highestZRef.current = Math.max(highestZRef.current, highestServerZ);

  function positionFor(note: StickyNote, index: number): StickyNoteLayout {
    return positionOverrides[note.id] ?? note.layout ?? autoStickyPosition(index);
  }

  function bringFront(noteId: string): number {
    const noteIndex = allActiveNotes.findIndex((note) => note.id === noteId);
    const note = allActiveNotes[noteIndex];
    if (!note) return ++highestZRef.current;
    const zIndex = ++highestZRef.current;
    const current = positionFor(note, Math.max(noteIndex, 0));
    setPositionOverrides((positions) => ({
      ...positions,
      [noteId]: { ...current, z_index: zIndex },
    }));
    return zIndex;
  }

  function savePosition(noteId: string, position: StickyNoteLayout) {
    setPositionOverrides((positions) => ({ ...positions, [noteId]: position }));
    void apiPut(`/sticky-notes/${noteId}/layout`, position).catch((caught) => {
      setBoardError(caught instanceof Error ? caught.message : "The note position could not be saved.");
    });
  }

  function startComposer(position: StickyNoteLayout) {
    setComposerPosition(position);
    setComposerOpen(true);
  }

  function addAtPointer(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || mobile || composerOpen) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const availableWidth = Math.max(rect.width - STICKY_CARD_WIDTH, 1);
    const availableHeight = Math.max(rect.height - STICKY_CARD_HEIGHT, 1);
    startComposer({
      x: clampUnit((event.clientX - rect.left - STICKY_CARD_WIDTH / 2) / availableWidth),
      y: clampUnit((event.clientY - rect.top - 24) / availableHeight),
      z_index: ++highestZRef.current,
    });
  }

  async function editNote(note: StickyNote, body: string) {
    await apiPatch(`/sticky-notes/${note.id}`, {
      body,
      expected_updated_at: note.updated_at,
    });
    await refreshNotes();
  }

  async function relinkNote(noteId: string, link: StickyNoteLinkValue | null) {
    await apiPut(`/sticky-notes/${noteId}/link`, {
      event_id: link?.event_id ?? null,
      organisation_id: link?.event_id ? null : link?.organisation_id ?? null,
    });
    await refreshNotes();
  }

  async function archiveNote(noteId: string) {
    await apiPost(`/sticky-notes/${noteId}/archive`);
    setPositionOverrides((positions) => {
      const next = { ...positions };
      delete next[noteId];
      return next;
    });
    await refreshNotes();
  }

  async function restoreNote(noteId: string) {
    await apiPost(`/sticky-notes/${noteId}/restore`);
    await refreshNotes();
  }

  async function deleteNote(noteId: string) {
    await apiDelete(`/sticky-notes/${noteId}`);
    setPositionOverrides((positions) => {
      const next = { ...positions };
      delete next[noteId];
      return next;
    });
    await refreshNotes();
  }

  function openEvent(eventId: string) {
    onClose();
    navigate(`/events/${eventId}/edit`);
  }

  async function autoArrange() {
    setBoardError(null);
    const arrangements = allActiveNotes.map((note, index) => ({
      note,
      position: autoStickyPosition(index),
    }));
    setPositionOverrides(Object.fromEntries(arrangements.map(({ note, position }) => [note.id, position])));
    try {
      await Promise.all(arrangements.map(({ note, position }) => apiPut(`/sticky-notes/${note.id}/layout`, position)));
      await activeQuery.refetch();
    } catch (caught) {
      setBoardError(caught instanceof Error ? caught.message : "The board could not be arranged.");
    }
  }

  function cancelComposer() {
    setComposerOpen(false);
    setDraftBody("");
    setDraftLink(null);
    createMutation.reset();
  }

  if (!open || !user) return null;

  const composerStyle: CSSProperties | undefined = mobile
    ? undefined
    : {
        left: composerPosition.x * Math.max(canvasSize.width - STICKY_CARD_WIDTH, 1),
        top: composerPosition.y * Math.max(canvasSize.height - STICKY_CARD_HEIGHT, 1),
        zIndex: composerPosition.z_index,
        transform: "rotate(-0.8deg)",
      };
  const people = peopleQuery.data?.people ?? [];
  const history = historyQuery.data;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="sticky-notes-title">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close team corkboard"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-ink-primary/20 backdrop-blur-[2px]"
      />
      <aside ref={panelRef} className="absolute inset-y-0 right-0 z-[90] flex w-full flex-col bg-marble-base shadow-2xl md:w-[72vw] md:max-w-[68rem]">
        <header className="carved-header flex flex-wrap items-center justify-between gap-3 bg-marble-highlight/90 px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-terracotta">Shared team memory</p>
            <h2 id="sticky-notes-title" className="text-lg font-semibold text-ink-primary etched-deep">Client call corkboard</h2>
          </div>
          <div className="flex items-center gap-2">
            {tab === "active" && (
              <>
                <button
                  type="button"
                  onClick={() => void autoArrange()}
                  disabled={allActiveNotes.length === 0}
                  className="rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-semibold text-ink-secondary disabled:opacity-50"
                >
                  Auto-arrange
                </button>
                <button
                  type="button"
                  onClick={() => startComposer({ ...DEFAULT_COMPOSER_POSITION, z_index: ++highestZRef.current })}
                  className="carved-btn-terracotta rounded-full bg-terracotta-btn px-3 py-1.5 text-xs font-semibold text-terracotta-text"
                >
                  + New note
                </button>
              </>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close corkboard"
              className="carved-btn flex h-9 w-9 items-center justify-center rounded-full bg-neutral-btn text-ink-secondary"
            >
              ×
            </button>
          </div>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex rounded-full bg-marble-shadow/55 p-1">
              <button
                type="button"
                onClick={() => setTab("active")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${tab === "active" ? "bg-sage-btn text-sage-text" : "text-ink-muted"}`}
              >
                Active ({allActiveNotes.length})
              </button>
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${tab === "history" ? "bg-sage-btn text-sage-text" : "text-ink-muted"}`}
              >
                History
              </button>
            </div>
            {tab === "active" && (
              <input
                type="search"
                value={activeSearch}
                onChange={(event) => setActiveSearch(event.target.value)}
                placeholder="Find a note…"
                aria-label="Search active notes"
                className="carved w-full max-w-xs rounded-xl bg-marble-shadow/40 px-3 py-1.5 text-xs text-ink-primary outline-none"
              />
            )}
          </div>
        </header>

        {tab === "active" ? (
          <div
            ref={canvasRef}
            onClick={addAtPointer}
            className="corkboard relative min-h-0 flex-1 overflow-auto p-4 md:overflow-hidden"
            aria-label="Active sticky notes. Click empty cork to add a note."
          >
            {activeQuery.isLoading && <p className="absolute inset-x-0 top-8 text-center text-sm font-semibold text-[#fff8dc]">Loading team notes…</p>}
            {activeQuery.error && <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-[#fff1dc] p-3 text-sm text-[#9c3f32]">{(activeQuery.error as Error).message}</p>}
            {!activeQuery.isLoading && activeNotes.length === 0 && !composerOpen && (
              <button
                type="button"
                onClick={() => startComposer({ ...DEFAULT_COMPOSER_POSITION, z_index: ++highestZRef.current })}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[#fff8dc]/90 px-6 py-4 text-center text-sm font-semibold text-[#6d5634] shadow-lg"
              >
                {allActiveNotes.length === 0 ? "The corkboard is clear. Stick the first client instruction." : "No notes match this search."}
              </button>
            )}
            <div className="flex flex-col gap-4 md:block">
              {composerOpen && mobile && (
                <div className="mx-auto">
                  <StickyNoteComposer
                    body={draftBody}
                    link={draftLink}
                    pending={createMutation.isPending}
                    error={createMutation.error instanceof Error ? createMutation.error.message : null}
                    onBodyChange={setDraftBody}
                    onLinkChange={setDraftLink}
                    onSave={() => createMutation.mutate()}
                    onCancel={cancelComposer}
                  />
                </div>
              )}
              {activeNotes.map((note) => {
                const index = allActiveNotes.findIndex((candidate) => candidate.id === note.id);
                return (
                  <StickyNoteCard
                    key={note.id}
                    note={note}
                    currentUserId={user.id}
                    position={positionFor(note, Math.max(index, 0))}
                    canvasSize={canvasSize}
                    mobile={mobile}
                    onBringFront={bringFront}
                    onMove={savePosition}
                    onEdit={editNote}
                    onRelink={relinkNote}
                    onArchive={archiveNote}
                    onDelete={deleteNote}
                  />
                );
              })}
            </div>
            {composerOpen && !mobile && (
              <div className="absolute" style={composerStyle}>
                <StickyNoteComposer
                  body={draftBody}
                  link={draftLink}
                  pending={createMutation.isPending}
                  error={createMutation.error instanceof Error ? createMutation.error.message : null}
                  onBodyChange={setDraftBody}
                  onLinkChange={setDraftLink}
                  onSave={() => createMutation.mutate()}
                  onCancel={cancelComposer}
                />
              </div>
            )}
            {!mobile && (
              <p className="pointer-events-none absolute bottom-3 left-4 rounded-full bg-black/20 px-3 py-1 text-[10px] font-semibold text-[#fff8dc]">
                Click empty cork to place a note anywhere
              </p>
            )}
            {boardError && (
              <button
                type="button"
                onClick={() => setBoardError(null)}
                className="absolute bottom-3 right-4 max-w-sm rounded-xl bg-[#fff1dc] px-3 py-2 text-left text-xs font-semibold text-[#9c3f32] shadow-lg"
              >
                {boardError} · Dismiss
              </button>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <section className="carved-card mb-4 grid gap-3 rounded-2xl bg-marble-highlight/65 p-4 sm:grid-cols-2 lg:grid-cols-5">
              <label className="sm:col-span-2 lg:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Search</span>
                <input
                  type="search"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Text or linked record…"
                  className="carved w-full rounded-lg bg-marble-shadow/40 px-2.5 py-2 text-xs text-ink-primary outline-none"
                />
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Creator</span>
                <select value={creatorFilter} onChange={(event) => setCreatorFilter(event.target.value)} className="carved w-full rounded-lg bg-marble-shadow/40 px-2 py-2 text-xs text-ink-primary">
                  <option value="">Anyone</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Actioned by</span>
                <select value={archiverFilter} onChange={(event) => setArchiverFilter(event.target.value)} className="carved w-full rounded-lg bg-marble-shadow/40 px-2 py-2 text-xs text-ink-primary">
                  <option value="">Anyone</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">From</span>
                <input type="date" value={fromFilter} onChange={(event) => setFromFilter(event.target.value)} className="carved w-full rounded-lg bg-marble-shadow/40 px-2 py-2 text-xs text-ink-primary" />
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">To</span>
                <input type="date" value={toFilter} onChange={(event) => setToFilter(event.target.value)} className="carved w-full rounded-lg bg-marble-shadow/40 px-2 py-2 text-xs text-ink-primary" />
              </label>
            </section>

            {historyQuery.isLoading ? (
              <p className="py-12 text-center text-sm text-ink-muted">Loading incorporated notes…</p>
            ) : historyQuery.error ? (
              <p role="alert" className="rounded-xl bg-terracotta-btn p-4 text-sm text-terracotta-text">{(historyQuery.error as Error).message}</p>
            ) : history?.notes.length ? (
              <div className="space-y-3">
                {history.notes.map((note) => (
                  <StickyNoteHistoryCard
                    key={note.id}
                    note={note}
                    currentUserId={user.id}
                    onRestore={restoreNote}
                    onDelete={deleteNote}
                    onOpenEvent={openEvent}
                  />
                ))}
                <div className="flex items-center justify-between pt-2 text-xs text-ink-muted">
                  <span>Showing {history.offset + 1}–{Math.min(history.offset + history.notes.length, history.total)} of {history.total}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} className="rounded-full bg-neutral-btn px-3 py-1.5 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={(historyPage + 1) * 50 >= history.total} onClick={() => setHistoryPage((page) => page + 1)} className="rounded-full bg-neutral-btn px-3 py-1.5 disabled:opacity-40">Next</button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="carved-card rounded-2xl bg-marble-highlight/55 px-6 py-12 text-center text-sm text-ink-muted">
                No incorporated notes match these filters.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
