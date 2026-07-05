/** Procedural marble backdrop: stage + two drifting vein layers (per design.md). */
export function MarbleBackdrop() {
  return (
    <>
      <div className="marble-stage" aria-hidden />
      <div className="vein vein-1" aria-hidden />
      <div className="vein vein-2" aria-hidden />
    </>
  );
}
