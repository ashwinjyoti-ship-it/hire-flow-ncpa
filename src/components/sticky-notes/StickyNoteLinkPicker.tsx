import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { formatDate } from "../../lib/use-lookups";

export type StickyNoteLinkValue = {
  event_id: string | null;
  event_title: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
};

type StickyNoteLinkPickerProps = {
  value: StickyNoteLinkValue | null;
  onChange: (value: StickyNoteLinkValue | null) => void;
  compact?: boolean;
};

type SearchEvent = {
  id: string;
  title: string;
  event_code: string | null;
  event_start_date: string | null;
  organisation_name: string | null;
};

type SearchOrganisation = {
  id: string;
  name: string;
};

export function StickyNoteLinkPicker({ value, onChange, compact = false }: StickyNoteLinkPickerProps) {
  const [editing, setEditing] = useState(!value);
  const [query, setQuery] = useState("");
  const term = query.trim();
  const enabled = editing && term.length >= 2;
  const eventsQuery = useQuery({
    queryKey: ["sticky-link-events", term],
    queryFn: () => apiGet<{ events: SearchEvent[] }>(`/events?q=${encodeURIComponent(term)}`),
    enabled,
  });
  const organisationsQuery = useQuery({
    queryKey: ["sticky-link-organisations", term],
    queryFn: () => apiGet<{ organisations: SearchOrganisation[] }>(`/organisations?q=${encodeURIComponent(term)}`),
    enabled,
  });

  if (value && !editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1 text-[11px] text-[#66583d]">
        <span className="min-w-0 flex-1 truncate">
          {value.event_title ?? value.organisation_name}
          {value.event_title && value.organisation_name ? ` · ${value.organisation_name}` : ""}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="font-semibold underline">Change</button>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setEditing(true);
          }}
          aria-label="Remove linked record"
          className="font-semibold"
        >
          ×
        </button>
      </div>
    );
  }

  if (!editing && !value) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-[11px] font-semibold text-[#78622e] underline">
        + Link event or organisation
      </button>
    );
  }

  const events = (eventsQuery.data?.events ?? []).slice(0, compact ? 3 : 5);
  const organisations = (organisationsQuery.data?.organisations ?? []).slice(0, compact ? 3 : 5);

  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find event or organisation…"
          aria-label="Find event or organisation to link"
          className="min-w-0 flex-1 rounded-lg bg-white/55 px-2 py-1.5 text-xs text-[#514937] outline-none ring-[#9f7a43]/30 focus:ring-2"
        />
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setQuery("");
          }}
          className="rounded-lg bg-black/5 px-2 text-xs text-[#66583d]"
        >
          Done
        </button>
      </div>
      {enabled && (
        <div className="absolute left-0 right-0 z-[120] mt-1 max-h-48 overflow-auto rounded-xl bg-[#fff9df] p-1.5 text-xs text-[#514937] shadow-xl">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => {
                onChange({
                  event_id: event.id,
                  event_title: event.title,
                  organisation_id: null,
                  organisation_name: event.organisation_name,
                });
                setEditing(false);
                setQuery("");
              }}
              className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-black/5"
            >
              <span className="block font-semibold">{event.title}</span>
              <span className="block text-[10px] opacity-70">
                Event{event.event_start_date ? ` · ${formatDate(event.event_start_date)}` : ""}
                {event.organisation_name ? ` · ${event.organisation_name}` : ""}
              </span>
            </button>
          ))}
          {organisations.map((organisation) => (
            <button
              key={organisation.id}
              type="button"
              onClick={() => {
                onChange({
                  event_id: null,
                  event_title: null,
                  organisation_id: organisation.id,
                  organisation_name: organisation.name,
                });
                setEditing(false);
                setQuery("");
              }}
              className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-black/5"
            >
              <span className="block font-semibold">{organisation.name}</span>
              <span className="block text-[10px] opacity-70">Organisation</span>
            </button>
          ))}
          {!eventsQuery.isFetching && !organisationsQuery.isFetching && events.length === 0 && organisations.length === 0 && (
            <p className="px-2 py-3 text-center opacity-65">No matching records.</p>
          )}
        </div>
      )}
    </div>
  );
}
