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

// Amount tokens the OCR renders in the right column. We deliberately require
// the token to be right-anchored on its line (or on its own line) so that we
// never mistake an in-line date fragment (`5 Jul 2025`) for an amount.
const AMOUNT_DOTTED = /(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/;   // 20,000.00 or -50,000.00
const AMOUNT_BIRR_RIGHT = /(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*Birr\s*$/i;
const INLINE_NAME_AMOUNT_BIRR_RIGHT = /^(.+?)\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*Birr\s*$/i;
const DATE_DDMMMYYYY = /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/;
const DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
// Fragmented ISO date the OCR sometimes leaves behind after chopping the
// year off ("-07-22", "-07-22 4 51 PM"). Anything that looks like this must
// never be considered an agent name.
const DATE_FRAGMENT = /^-?\d{1,4}[-/]\d{1,2}([-/]\d{1,2})?\b/;
const TIME_AMPM = /\d{1,2}:\d{2}\s*(AM|PM)/i;
// OCR frequently drops the ":" in a time, so "4:51 PM" arrives as "4 51 PM".
const TIME_LOOSE = /\b\d{1,2}\s+\d{2}\s*(AM|PM)\b/i;
const NOISE_RX = /^(transfers|received|sent|refill history|agents|add agent|refill|balance|home|amount|date|name|status|success|successful)\s*$/i;
// Names on the distributor screenshots are always alphabetic (Latin or Ethiopic
// script), with spaces / hyphens / apostrophes / dots. Any digit disqualifies
// the line — that's how we stop dates and amounts leaking into the name slot.
const NAME_RX = /^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F\s'.\-]{1,58}$/;
const MONTHS_RX = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0 && !NOISE_RX.test(l));
}

/**
 * Strip currency/label tokens that OCR often glues onto the end of a name
 * line (e.g. "Birukeee Birr" → "Birukeee"). Called before NAME_RX validation
 * so a stray label doesn't disqualify an otherwise-valid alphabetic name.
 */
function stripNameTrailers(line: string): string {
  return line.replace(/\s+(Birr|ETB|EVD|Float|Review|Link\s+to\s+agent.*)$/i, "").trim();
}

/**
 * Strip leading bullet/icon/punctuation noise OCR prepends to agent name
 * lines in some distributor apps (e.g. "& Sintayehu", "· Abebe", "oA Gojeeeee").
 * Runs before NAME_RX validation.
 */
function stripNameLeaders(line: string): string {
  // Drop any run of non-letter chars from the start, plus a common OCR
  // artifact where 1-2 stray latin letters precede the real name
  // ("oA Gojeeeee" → "Gojeeeee"). Only strip the short prefix when it is
  // followed by a space and a longer alphabetic token.
  let out = line.replace(/^[^A-Za-z\u1200-\u137F]+/, "").trim();
  const m = out.match(/^([A-Za-z]{1,2})\s+([A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F'.\-]{2,})$/);
  if (m) out = m[2];
  return out;
}

/**
 * Reject "amounts" that are actually a 4-digit year the OCR rendered with a
 * thousands separator ("2,026" from "2026-07-22"). Real airtime top-ups are
 * never posted as an exact integer year with no cents.
 */
function looksLikeYearAmount(raw: string): boolean {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isInteger(n) && n >= 1900 && n <= 2100;
}

function looksLikeName(line: string): boolean {
  if (!line) return false;
  const cleaned = stripNameTrailers(stripNameLeaders(line));
  if (!cleaned) return false;
  // Agent names are alphabetic only — no digits, no time (AM/PM), no dates.
  if (/\d/.test(cleaned)) return false;
  if (TIME_AMPM.test(cleaned) || TIME_LOOSE.test(cleaned)) return false;
  if (DATE_FRAGMENT.test(cleaned)) return false;
  if (!NAME_RX.test(cleaned)) return false;
  // Month-name-only lines ("Jul", "July") slip through NAME_RX; reject them
  // when they're the whole line and there's no other word.
  if (MONTHS_RX.test(cleaned) && cleaned.split(/\s+/).length === 1) return false;
  return true;
}

/**
 * Canonical agent name after label-stripping. Callers should use this so the
 * name persisted to the DB is "Birukeee", not "Birukeee Birr".
 */
function normalizeName(line: string): string {
  return stripNameTrailers(stripNameLeaders(line));
}

function looksLikeDateOrTime(line: string): boolean {
  return DATE_ISO.test(line) || TIME_AMPM.test(line) || TIME_LOOSE.test(line) || DATE_DDMMMYYYY.test(line) || DATE_FRAGMENT.test(line);
}

function parseInlineNameAmount(line: string): { agentName: string; amountStr: string } | null {
  const match = line.match(INLINE_NAME_AMOUNT_BIRR_RIGHT);
  if (!match) return null;
  const candidateName = normalizeName(match[1]);
  if (!looksLikeName(candidateName)) return null;
  if (looksLikeYearAmount(match[2])) return null;
  return { agentName: candidateName, amountStr: match[2] };
}

function isLikelyRefillHistory(text: string): boolean {
  const lines = cleanLines(text);
  let pairedRows = 0;
  for (let i = 0; i < lines.length; i++) {
    const inline = parseInlineNameAmount(lines[i]);
    if (!inline) continue;
    const next = lines[i + 1];
    const prev = lines[i - 1];
    if ((next && looksLikeDateOrTime(next)) || (prev && looksLikeDateOrTime(prev))) {
      pairedRows++;
    }
  }
  const hasRefillHeading = lines.some((line) => /refill\s+history/i.test(line));
  return pairedRows >= 2 || (hasRefillHeading && pairedRows >= 1);
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
        // Right-side amount only: whole-line number, or trailing number.
        const am = ln.match(new RegExp("^" + AMOUNT_DOTTED.source + "$"))
          ?? ln.match(new RegExp(AMOUNT_DOTTED.source + "\\s*$"));
        if (am && !DATE_DDMMMYYYY.test(ln) && !DATE_ISO.test(ln)) {
          amountStr = am[1]; j++; continue;
        }
      }
      if (!agentName && looksLikeName(ln)) {
        // Guard: don't pick the next sender line as an agent.
        if (/^([A-Za-z0-9._-]{3,})\s*[-–]\s*\1\b/i.test(ln)) break;
        agentName = normalizeName(ln);
        j++;
        break;
      }
      j++;
    }
    const raw = lines.slice(i, j).join(" | ");
    if (!amountStr || !agentName || looksLikeYearAmount(amountStr)) {
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
    // Screenshot-list shape:
    //   <AGENT NAME> <AMOUNT> Birr
    //   <YYYY-MM-DD H:MM AM/PM>
    // In this layout the ONLY data row is the name+right-anchored amount line;
    // the following date/time line is metadata and must never become a row.
    const inline = parseInlineNameAmount(lines[i]);
    if (inline) {
      let dateText: string | undefined;
      for (let k = i + 1; k <= Math.min(lines.length - 1, i + 2); k++) {
        if (looksLikeDateOrTime(lines[k])) {
          dateText = lines[k];
          break;
        }
      }
      if (!dateText) {
        for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
          if (looksLikeDateOrTime(lines[k])) {
            dateText = lines[k];
            break;
          }
        }
      }
      const santim = toSantim(inline.amountStr);
      out.push({
        ok: true,
        raw: dateText ? `${lines[i]} | ${dateText}` : lines[i],
        agentName: inline.agentName,
        dateText,
        airtimeType: "airtime_evd",
        amountSantim: Math.abs(santim),
        isReversal: santim < 0,
        needsReview: santim < 0 || !dateText,
      });
      continue;
    }

    // Amounts must be right-aligned "<number> Birr" at end of line — never
    // mid-line, so a date fragment can't be misread as an amount.
    const amtM = lines[i].match(AMOUNT_BIRR_RIGHT);
    if (!amtM) continue;
    // A line that also carries an ISO date or a time is a header/date band,
    // not an amount row (OCR sometimes glues "2026 Birr" onto a date line).
    if (DATE_ISO.test(lines[i]) || TIME_AMPM.test(lines[i]) || TIME_LOOSE.test(lines[i])) continue;
    // "2,026" (the year) is not an airtime amount.
    if (looksLikeYearAmount(amtM[1])) continue;
    // Walk backward through up to 4 previous lines to find date + name.
    let dateText: string | undefined;
    let agentName: string | undefined;
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const ln = lines[k];
      if (!dateText && looksLikeDateOrTime(ln)) {
        dateText = ln;
        continue;
      }
      if (dateText && !agentName && looksLikeName(ln)) {
        agentName = normalizeName(ln);
        break;
      }
      // Name may also appear even without a date (some rows OCR the date poorly).
      if (!dateText && !agentName && looksLikeName(ln)) {
        agentName = normalizeName(ln);
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
  if (format === "generic" && isLikelyRefillHistory(text)) {
    return parseRefillHistory(text);
  }
  const template = APP_TEMPLATES[format];
  if (template) {
    // Trust the per-app template: if it decides nothing in the OCR looks like
    // a valid row, we do NOT fall back to the generic scraper. The generic
    // scraper is line-oriented and happily turns date fragments into "rows",
    // which is exactly the junk the templates exist to suppress.
    return template(text);
  }
  return parseGeneric(text);
}