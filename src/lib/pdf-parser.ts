// Client-side distributor statement parser.

import type { TxnType } from "./types";

export interface StatementRow {
  ok: boolean;
  raw: string;
  agentName?: string;
  phone?: string;
  airtimeType?: Extract<TxnType, "airtime_evd" | "airtime_float">;
  amountSantim?: number;
  reference?: string;
  reason?: string;
}

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

function toSantim(s: string): number {
  const n = Number(s.replace(/,/g, "").trim());
  return Math.round(n * 100);
}

function parseGenericLine(raw: string): StatementRow {
  const line = raw.replace(/\s+/g, " ").trim();
  if (!line) return { ok: false, raw, reason: "empty" };
  const amtM = line.match(/(?:ETB|Br\.?)?\s*([\d]{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!amtM) return { ok: false, raw: line, reason: "no amount" };
  const evd = /\b(EVD|E-?voucher|voucher)\b/i.test(line);
  const flt = /\b(float|balance transfer|B2B)\b/i.test(line);
  const airtimeType: StatementRow["airtimeType"] = flt
    ? "airtime_float"
    : evd
      ? "airtime_evd"
      : "airtime_evd";
  const phoneM = line.match(/\b(?:251)?0?9\d{8}\b/);
  const refM = line.match(/\b(?:Ref|Txn|TrxID|ID)[:# ]*([A-Za-z0-9]{4,})/i);
  let agentName = line
    .replace(amtM[0], "")
    .replace(phoneM?.[0] ?? "", "")
    .replace(/\b(EVD|E-?voucher|voucher|float|balance transfer|B2B)\b/gi, "")
    .replace(refM?.[0] ?? "", "")
    .replace(/\b(ETB|Br\.?)\b/gi, "")
    .replace(/[|,;:]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (agentName.length > 60) agentName = agentName.slice(0, 60);
  if (!agentName || agentName.length < 2) return { ok: false, raw: line, reason: "no name" };
  return {
    ok: true,
    raw: line,
    agentName,
    phone: phoneM?.[0],
    airtimeType,
    amountSantim: toSantim(amtM[1]),
    reference: refM?.[1],
  };
}

export function parseStatementText(text: string): StatementRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8)
    .filter((l) => /\d[\d,]*(?:\.\d+)?/.test(l))
    .filter((l) => !/^(agent|name|phone|amount|type|reference|total|page|date)\b/i.test(l))
    .map(parseGenericLine);
}