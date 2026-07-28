/**
 * Open a printable HTML document in a new tab for review before printing.
 */

export type OpenPrintableHtmlOptions = {
  /** When true, open the browser print dialog after the preview loads (Save as PDF). */
  autoPrint?: boolean;
};

/** Open printable HTML in a new tab. Optionally auto-opens the print dialog for PDF export. */
export function openPrintableHtml(html: string, options?: OpenPrintableHtmlOptions): void {
  const win = window.open("", "_blank");
  if (!win) return;

  win.document.open();
  win.document.write(html);
  win.document.close();

  if (options?.autoPrint) {
    win.addEventListener("load", () => {
      win.focus();
      win.print();
    });
  }
}

/** Open a server-rendered printable page (e.g. saved report PDF HTML). */
export function openPrintableUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
