/** Scroll helpers for the AppShell `#app-main` pane (window scroll is locked). */

export function getAppMain(): HTMLElement | null {
  return document.getElementById("app-main");
}

/** Pure offset math — kept separate so nested-overflow scrolling can be unit-tested. */
export function nextAppMainScrollTop(args: {
  mainTop: number;
  mainHeight: number;
  mainScrollTop: number;
  targetTop: number;
  targetHeight: number;
  align: "start" | "center";
}): number {
  let delta = args.targetTop - args.mainTop;
  if (args.align === "center") {
    delta -= (args.mainHeight - args.targetHeight) / 2;
  }
  return Math.max(0, args.mainScrollTop + delta);
}

/** Scroll the app main pane so `element` aligns to start or center. */
export function scrollAppMainToElement(
  element: HTMLElement,
  align: "start" | "center" = "start",
  behavior: ScrollBehavior = "smooth",
): void {
  const main = getAppMain();
  if (!main) {
    element.scrollIntoView({ behavior, block: align });
    return;
  }

  const mainRect = main.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();
  const top = nextAppMainScrollTop({
    mainTop: mainRect.top,
    mainHeight: main.clientHeight,
    mainScrollTop: main.scrollTop,
    targetTop: elRect.top,
    targetHeight: elRect.height,
    align,
  });
  main.scrollTo({ top, behavior });
}

/** Scroll the app main pane to an element by id, or to the top if missing. */
export function scrollAppMainToId(
  targetId: string,
  align: "start" | "center" = "start",
  behavior: ScrollBehavior = "smooth",
): void {
  const target = document.getElementById(targetId);
  if (target) {
    scrollAppMainToElement(target, align, behavior);
    return;
  }
  scrollAppMainToTop(behavior);
}

export function scrollAppMainToTop(behavior: ScrollBehavior = "smooth"): void {
  const main = getAppMain();
  if (main) {
    main.scrollTo({ top: 0, behavior });
    return;
  }
  window.scrollTo({ top: 0, behavior });
}
