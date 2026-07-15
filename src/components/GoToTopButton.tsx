/** Fixed floating control that scrolls back to the top of a long form. */
export function GoToTopButton({ targetId }: { targetId: string }) {
  function goToTop() {
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={goToTop}
      className="carved-btn fixed right-3 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 rounded-2xl bg-marble-highlight/90 px-3 py-2.5 text-sm font-semibold text-ink-secondary backdrop-blur-sm hover:bg-marble-highlight sm:right-5"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Go to top
    </button>
  );
}
