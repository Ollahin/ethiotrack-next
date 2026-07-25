// Client-side PDF text extraction. Parsing lives in distributor-parser.ts so
// PDF-extracted text and OCR'd screenshot text run through the same pipeline.

export { parseStatementText, parseGeneric } from "./distributor-parser";
export type { StatementRow } from "./distributor-parser";

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function loadPdfjs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import("pdfjs-dist");
  const workerMod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default;
  _pdfjs = pdfjs;
  return pdfjs;
}

export async function extractPdfText(file: File | ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  const data =
    file instanceof ArrayBuffer ? file : new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform?: number[] }>;
    const byLine = new Map<number, string[]>();
    for (const it of items) {
      const y = it.transform ? Math.round(it.transform[5]) : 0;
      byLine.set(y, [...(byLine.get(y) ?? []), it.str]);
    }
    const lines = [...byLine.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    parts.push(lines.join("\n"));
  }
  return parts.join("\n");
}