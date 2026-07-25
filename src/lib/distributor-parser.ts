// Format-dispatch layer for distributor statement imports.
//
// Both PDF text extraction (pdf-parser.ts) and screenshot OCR (ocr.ts) feed
// into this module. The distributor's `statementFormat` field decides which
// per-app template to try first; if none is registered (or none matches) we
// fall back to a layout-agnostic line scraper.
//
// APP_TEMPLATES is intentionally empty for MJ / Alami / Yenus / Tilanesh /
// Modern App until real samples are captured. A wrong template produces
// confident-looking wrong data, which is worse than the generic fallback
// flagging rows for review. To add a template later:
//
//   APP_TEMPLATES["mj"] = (text) => [ /* StatementRow[] */ ];

import type { DistributorStatementFormat, TxnType } from "./types";

export interface StatementRow {
  ok: boolean;
  raw: string;
  agentName?: string;
  phone?: string;
  airtimeType?: Extract<TxnType, "airtime_evd" | "airtime_float">;
  amountSantim?: number;
  reference?: string;
  reason?: string;
  /** Parser was uncertain — surface for human review before commit. */
  needsReview?: boolean;
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
  const airtimeType: StatementRow["airtimeType"] = flt ? "airtime_float" : evd ? "airtime_evd" : "airtime_evd";
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
  // Neither EVD nor Float keyword present, or no explicit form — flag for review.
  const ambiguousForm = !evd && !flt;
  if (!agentName || agentName.length < 2) {
    return { ok: false, raw: line, reason: "no name" };
  }
  return {
    ok: true,
    raw: line,
    agentName,
    phone: phoneM?.[0],
    airtimeType,
    amountSantim: toSantim(amtM[1]),
    reference: refM?.[1],
    needsReview: ambiguousForm || !refM,
  };
}

export function parseGeneric(text: string): StatementRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8)
    .filter((l) => /\d[\d,]*(?:\.\d+)?/.test(l))
    .filter((l) => !/^(agent|name|phone|amount|type|reference|total|page|date)\b/i.test(l))
    .map(parseGenericLine);
}

/** Per-app parsers. Fill in once real samples exist — see file header. */
const APP_TEMPLATES: Partial<Record<DistributorStatementFormat, (text: string) => StatementRow[]>> = {
  // mj: (text) => [...],
  // alami: (text) => [...],
  // yenus: (text) => [...],
  // tilanesh: (text) => [...],
  // "modern-app": (text) => [...],
};

/**
 * Parse extracted statement text with the best available strategy for the
 * given distributor format. Falls back to the generic scraper when the app
 * template is missing or yields zero rows.
 */
export function parseStatementText(
  text: string,
  format: DistributorStatementFormat = "generic",
): StatementRow[] {
  const template = APP_TEMPLATES[format];
  if (template) {
    const rows = template(text);
    if (rows.length) return rows;
  }
  return parseGeneric(text);
}