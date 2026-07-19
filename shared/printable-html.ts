/**
 * Shared printable HTML chrome for client previews and Worker-rendered report pages.
 * Standard flow: open preview → user clicks Print or Export to PDF → browser dialog.
 */

export function escapePrintableHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PRINTABLE_TOOLBAR_HTML = `<div class="toolbar">
  <button type="button" onclick="window.print()">Print</button>
  <button type="button" onclick="window.print()">Export to PDF</button>
</div>`;

export const PRINTABLE_PAGE_CSS = `
  :root { color-scheme: light; }
  @page { size: A4; margin: 18mm 15mm 20mm 15mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #2f2c27;
    line-height: 1.45;
    font-size: 10.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media screen {
    body { margin: 28px auto; padding: 0 12px; max-width: 210mm; }
  }
  header {
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid #cfc7ba;
  }
  h1 { font-size: 18pt; line-height: 1.25; margin: 0 0 6px; font-weight: 700; }
  .header-summary { margin: 0 0 8px; font-size: 10.5pt; color: #4a453d; line-height: 1.5; }
  .meta { color: #6b655c; font-size: 9pt; margin: 0 0 16px; }
  h2 {
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 20px 0 8px;
    border-bottom: 1px solid #cfc7ba;
    padding-bottom: 4px;
  }
  h3 { font-size: 11pt; margin: 14px 0 6px; }
  h4 { font-size: 10pt; margin: 10px 0 4px; color: #5c564c; }
  section { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  table.fields { table-layout: fixed; }
  table th, table td { vertical-align: top; padding: 5px 10px 5px 0; border-bottom: 1px solid #ece7df; }
  table th { text-align: left; font-weight: 600; color: #5c564c; }
  table.fields th { width: 34%; }
  table.fields td { width: 66%; white-space: pre-wrap; word-break: break-word; }
  table td { white-space: pre-wrap; word-break: break-word; }
  .venue-block { margin-bottom: 14px; }
  .schedule, .docs { margin: 0; padding-left: 18px; }
  .schedule li, .docs li { margin: 3px 0; }
  .empty, .notes { margin: 0; }
  .sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 8px; }
  .sign-box { min-height: 72px; }
  .sign-label { font-size: 9pt; color: #5c564c; margin-bottom: 28px; }
  .sign-line { border-bottom: 1px solid #2f2c27; margin-bottom: 4px; }
  .sign-meta { font-size: 8pt; color: #6b655c; }
  .toolbar { margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .toolbar button { font: inherit; padding: 6px 14px; cursor: pointer; }
  .mom-document { font-size: 11pt; }
  @media print {
    .toolbar { display: none; }
    header { break-after: avoid-page; page-break-after: avoid; }
    h2, h3, h4 { break-after: avoid-page; page-break-after: avoid; }
    table tr { break-inside: avoid; page-break-inside: avoid; }
    .venue-block { break-inside: avoid-page; page-break-inside: avoid; }
    .sign-grid { break-inside: avoid; page-break-inside: avoid; }
  }
`;

export type PrintablePageOptions = {
  title: string;
  bodyHtml: string;
  extraCss?: string;
};

export function buildPrintablePageHtml({ title, bodyHtml, extraCss = "" }: PrintablePageOptions): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapePrintableHtml(title)}</title>
<style>
${PRINTABLE_PAGE_CSS}
${extraCss}
</style></head>
<body>
${PRINTABLE_TOOLBAR_HTML}
${bodyHtml}
</body></html>`;
}
