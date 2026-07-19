/**
 * Open a printable HTML document in a new tab for review before printing.
 */

/** Open printable HTML in a new tab. Never auto-triggers the print dialog. */
export function openPrintableHtml(html: string): void {
  const win = window.open("", "_blank");
  if (!win) return;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** Open a server-rendered printable page (e.g. saved report PDF HTML). */
export function openPrintableUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
