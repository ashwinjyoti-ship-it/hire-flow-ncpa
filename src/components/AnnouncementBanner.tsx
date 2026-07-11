/**
 * Pinned team announcement — a whiteboard, not a chat. Only one announcement
 * is ever live; posting a new one replaces it. Shown at the top of the
 * Dashboard: everyone sees the live banner (dismissible per-person), and
 * whoever holds `announcement.manage` (the admin) also gets a small composer
 * right above it, so she's always looking at exactly what the team sees.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { formatDateTime } from "../lib/use-lookups";
import { useAuth } from "../lib/auth";
import { can } from "../lib/can";

type Announcement = {
  id: string;
  message: string;
  created_at: string;
  expires_at: string | null;
  created_by_name: string | null;
  dismissed_by_me: boolean;
};

type ActiveResponse = { announcement: Announcement | null };

const EXPIRY_OPTIONS = [
  { label: "Expires in 24 hours", hours: 24 },
  { label: "Expires in 3 days", hours: 72 },
  { label: "Expires in 7 days", hours: 24 * 7 },
  { label: "No auto-expiry", hours: 0 },
] as const;

export function AnnouncementBanner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = can(user?.permissions, "announcement.manage");

  const { data } = useQuery({
    queryKey: ["announcement", "active"],
    queryFn: () => apiGet<ActiveResponse>("/announcements/active"),
  });
  const live = data?.announcement ?? null;

  const dismiss = useMutation({
    mutationFn: (id: string) => apiPost(`/announcements/${id}/dismiss`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcement", "active"] }),
  });

  return (
    <div className="mb-4 space-y-3 print-hidden">
      {canManage && <AnnouncementComposer live={live} />}
      {live && !live.dismissed_by_me && (
        <div className="carved-card flex items-start gap-3 rounded-2xl bg-sage-btn/70 p-4">
          <span className="mt-0.5 text-base" aria-hidden="true">📌</span>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-sm font-medium text-ink-primary etched-deep">{live.message}</p>
            <p className="mt-1 text-[11px] text-ink-muted etched">
              {live.created_by_name ? `Posted by ${live.created_by_name}` : "Posted"} · {formatDateTime(live.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss.mutate(live.id)}
            aria-label="Dismiss announcement"
            title="Dismiss"
            className="shrink-0 rounded-full px-2 py-1 text-sm text-ink-muted hover:bg-marble-shadow/50 hover:text-ink-primary"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function AnnouncementComposer({ live }: { live: Announcement | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [expiryHours, setExpiryHours] = useState<number>(72);

  const post = useMutation({
    mutationFn: () => apiPost("/announcements", { message: message.trim(), expires_in_hours: expiryHours }),
    onSuccess: () => {
      setMessage("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["announcement", "active"] });
    },
  });

  const clear = useMutation({
    mutationFn: () => apiDelete("/announcements/active"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcement", "active"] }),
  });

  if (!open) {
    return (
      <div className="carved-card flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-marble-highlight/50 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-sage etched">
          {live ? "Team announcement is live" : "No team announcement pinned"}
        </span>
        <div className="flex gap-2">
          {live && (
            <button
              type="button"
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
              className="rounded-full bg-neutral-btn px-3 py-1 text-xs font-medium text-ink-secondary etched disabled:opacity-60"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => { setMessage(live?.message ?? ""); setOpen(true); }}
            className="carved-btn-sage rounded-full bg-sage-btn px-3 py-1 text-xs font-semibold text-sage-text etched"
          >
            {live ? "Update" : "Post announcement"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="carved-card rounded-2xl bg-marble-highlight/50 p-4">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-sage etched">
        {live ? "Update team announcement" : "Post a team announcement"}
      </span>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="e.g. No evening bookings this week — generator under repair."
        className="carved w-full rounded-xl bg-marble-shadow/40 px-3 py-2 text-sm text-ink-primary focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <select
          value={expiryHours}
          onChange={(e) => setExpiryHours(Number(e.target.value))}
          className="carved rounded-xl bg-marble-shadow/40 px-2 py-1 text-xs text-ink-secondary focus:outline-none"
        >
          {EXPIRY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-neutral-btn px-3 py-1.5 text-xs font-medium text-ink-secondary etched">
            Cancel
          </button>
          <button
            type="button"
            disabled={!message.trim() || post.isPending}
            onClick={() => post.mutate()}
            className="carved-btn-sage rounded-full bg-sage-btn px-4 py-1.5 text-xs font-semibold text-sage-text etched disabled:opacity-60"
          >
            {post.isPending ? "Posting..." : live ? "Replace announcement" : "Post to team"}
          </button>
        </div>
      </div>
      {post.error && <p role="alert" className="mt-2 text-xs text-status-cancelled etched">{(post.error as Error).message}</p>}
    </div>
  );
}
