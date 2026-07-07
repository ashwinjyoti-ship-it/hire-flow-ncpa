/**
 * Lightweight client-side export helpers (no heavy libraries).
 * Word export writes a Word-compatible HTML document with a .doc extension —
 * Microsoft Word and LibreOffice open these natively.
 */

export function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build one export table section (title + header row + data rows). */
export function htmlTableSection(title: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell == null ? "" : String(cell))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}"><i>Nothing recorded</i></td></tr>`;
  return `<h2>${escapeHtml(title)}</h2>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:11pt">
<thead><tr>${headers.map((h) => `<th align="left">${escapeHtml(h)}</th>`).join("")}</tr></thead>
<tbody>${body}</tbody></table>`;
}

/** Download an HTML body as a Word-compatible .doc file. */
export function downloadWordDoc(fileName: string, title: string, bodyHtml: string): void {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Georgia,'Times New Roman',serif}h1{font-size:16pt}h2{font-size:12pt;margin:16pt 0 4pt}</style>
</head><body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".doc") ? fileName : `${fileName}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
