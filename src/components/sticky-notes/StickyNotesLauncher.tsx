import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";

type StickyNotesLauncherProps = {
  onOpen: () => void;
};

export function StickyNotesLauncher({ onOpen }: StickyNotesLauncherProps) {
  const { data } = useQuery({
    queryKey: ["sticky-note-summary"],
    queryFn: () => apiGet<{ active_count: number; newest_updated_at: string | null }>("/sticky-notes/summary"),
    refetchInterval: 15_000,
  });
  const count = data?.active_count ?? 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open team corkboard${count ? `, ${count} active notes` : ""}`}
      title="Team corkboard"
      className="carved-btn relative flex h-9 w-9 items-center justify-center rounded-full bg-[#f7e6a2] text-[#78622e]"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M7 4.5h10a2 2 0 012 2V18a2 2 0 01-2 2H7a2 2 0 01-2-2V6.5a2 2 0 012-2z" />
        <path d="M9 4.5V3h6v1.5M8.5 9h7M8.5 13h5" strokeLinecap="round" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-semibold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
