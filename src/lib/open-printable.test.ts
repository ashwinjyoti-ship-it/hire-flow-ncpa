import { describe, expect, it, vi } from "vitest";
import { openPrintableHtml, openPrintableUrl } from "./open-printable";

describe("open-printable", () => {
  it("writes HTML into a new tab without auto-printing", () => {
    const writes: string[] = [];
    const mockWin = {
      document: {
        open: () => undefined,
        write: (html: string) => {
          writes.push(html);
        },
        close: () => undefined,
      },
    };
    const openSpy = vi.fn().mockReturnValue(mockWin);
    vi.stubGlobal("window", { open: openSpy });

    openPrintableHtml("<p>Preview</p>");

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(writes).toEqual(["<p>Preview</p>"]);

    vi.unstubAllGlobals();
  });

  it("opens server-rendered printable URLs in a new tab", () => {
    const openSpy = vi.fn();
    vi.stubGlobal("window", { open: openSpy });

    openPrintableUrl("/api/reports/daily/1/pdf");

    expect(openSpy).toHaveBeenCalledWith("/api/reports/daily/1/pdf", "_blank", "noopener,noreferrer");

    vi.unstubAllGlobals();
  });
});
