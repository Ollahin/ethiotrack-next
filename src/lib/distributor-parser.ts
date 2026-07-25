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
  /** Sender identity as printed on the row (e.g. "barisohaji - barisohaji"). MJ only. */
  sender?: string;
  /** Row-level date string as printed on the screen (parser does not normalize). */
  dateText?: string;
  /** Negative amounts (reversals) are captured so the caller can flag them. */
  isReversal?: boolean;
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

// ---------------------------------------------------------------------------
// App templates — built from real screenshot samples.
//
// The distributor apps don't produce structured exports; the user captures
// them as screenshots and Tesseract OCRs them. Layouts fall into two shapes:
//
//  A) MJ — paired "card" per row:
//        <SENDER> - <SENDER>          <AMOUNT>.00
//        <DD MMM YYYY>
//        <AGENT NAME>
//     Amount may be negative on reversals ("-50,000.00"). The right-aligned
//     amount usually lands on the same line as the sender or on its own line.
//
//  B) Alami / Yenus / Modern App "Refill History" — flat rows:
//        <AGENT NAME>
//        <YYYY-MM-DD H:MM AM/PM>
//        <AMOUNT> Birr
//
// Both layouts assume EVD by default (the distributor apps deliver airtime
// stock; the form is decided at the distributor level, not per row). The
// caller may override `airtimeType` later from the selected distributor's
// declared `forms`.
// ---------------------------------------------------------------------------

const AMOUNT_DOTTED = /(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;   // 20,000.00 or -50,000.00
const AMOUNT_BIRR = /(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*Birr/i;
const DATE_DDMMMYYYY = /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/;
const DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const NOISE_RX = /^(transfers|received|sent|refill history|agents|add agent|refill|balance|home)\s*$/i;

function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0 && !NOISE_RX.test(l));
}

function looksLikeName(line: string): boolean {
  if (!line) return false;
  if (DATE_DDMMMYYYY.test(line) || DATE_ISO.test(line)) return false;
  if (AMOUNT_DOTTED.test(line) && !/[A-Za-z\u1200-\u137F]{3,}/.test(line)) return false;
  if (AMOUNT_BIRR.test(line)) return false;
  if (/\d{2}:\d{2}/.test(line)) return false;
  if (line.length < 2 || line.length > 60) return false;
  return /[A-Za-z\u1200-\u137F]/.test(line);
}

/** MJ layout — paired sender/date/agent card, right-aligned amount. */
function parseMj(text: string): StatementRow[] {
  const lines = cleanLines(text);
  const out: StatementRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Sender lines look like "barisohaji - barisohaji" (repeated handle).
    const senderM = line.match(/^([A-Za-z0-9._-]{3,})\s*[-–]\s*\1\b/i);
    if (!senderM) { i++; continue; }
    const sender = senderM[1];
    // Amount can be on the same line (right-aligned) or on the next 1-2 lines.
    let amountStr: string | undefined;
    let dateText: string | undefined;
    let agentName: string | undefined;
    const tailAmt = line.match(new RegExp(AMOUNT_DOTTED.source + "\\s*$"));
    if (tailAmt) amountStr = tailAmt[1];
    // Scan the next few lines for missing pieces + agent name.
    let j = i + 1;
    const windowEnd = Math.min(lines.length, i + 6);
    while (j < windowEnd) {
      const ln = lines[j];
      if (!dateText) {
        const dm = ln.match(DATE_DDMMMYYYY);
        if (dm) {
          dateText = dm[0];
          // Amount often shares this line, right-aligned.
          const am = ln.match(new RegExp(AMOUNT_DOTTED.source + "\\s*$"));
          if (am && !amountStr) amountStr = am[1];
          j++;
          continue;
        }
      }
      if (!amountStr) {
        const am = ln.match(new RegExp("^" + AMOUNT_DOTTED.source + "$"));
        if (am) { amountStr = am[1]; j++; continue; }
      }
      if (!agentName && looksLikeName(ln)) {
        // Guard: don't pick the next sender line as an agent.
        if (/^([A-Za-z0-9._-]{3,})\s*[-–]\s*\1\b/i.test(ln)) break;
        agentName = ln;
        j++;
        break;
      }
      j++;
    }
    const raw = lines.slice(i, j).join(" | ");
    if (!amountStr || !agentName) {
      out.push({ ok: false, raw, reason: !amountStr ? "no amount" : "no agent", sender });
    } else {
      const santim = toSantim(amountStr);
      out.push({
        ok: true,
        raw,
        sender,
        dateText,
        agentName,
        airtimeType: "airtime_evd",
        amountSantim: Math.abs(santim),
        isReversal: santim < 0,
        // Reversals + missing date always deserve a human eyeball.
        needsReview: santim < 0 || !dateText,
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Alami / Yenus / Modern App "Refill History" — flat row triplets. */
function parseRefillHistory(text: string): StatementRow[] {
  const lines = cleanLines(text);
  const out: StatementRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const amtM = lines[i].match(AMOUNT_BIRR);
    if (!amtM) continue;
    // Walk backward through up to 4 previous lines to find date + name.
    let dateText: string | undefined;
    let agentName: string | undefined;
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const ln = lines[k];
      if (!dateText && (DATE_ISO.test(ln) || /\d{1,2}:\d{2}\s*(AM|PM)/i.test(ln))) {
        dateText = ln;
        continue;
      }
      if (dateText && !agentName && looksLikeName(ln)) {
        agentName = ln;
        break;
      }
      // Name may also appear even without a date (some rows OCR the date poorly).
      if (!dateText && !agentName && looksLikeName(ln) && !AMOUNT_BIRR.test(ln)) {
        agentName = ln;
        break;
      }
    }
    const raw = lines.slice(Math.max(0, i - 2), i + 1).join(" | ");
    if (!agentName) {
      out.push({ ok: false, raw, reason: "no agent" });
      continue;
    }
    const santim = toSantim(amtM[1]);
    out.push({
      ok: true,
      raw,
      agentName,
      dateText,
      airtimeType: "airtime_evd",
      amountSantim: Math.abs(santim),
      isReversal: santim < 0,
      needsReview: santim < 0 || !dateText,
    });
  }
  return out;
}

const APP_TEMPLATES: Partial<Record<DistributorStatementFormat, (text: string) => StatementRow[]>> = {
  mj: parseMj,
  alami: parseRefillHistory,
  yenus: parseRefillHistory,
  tilanesh: parseRefillHistory,
  "modern-app": parseRefillHistory,
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