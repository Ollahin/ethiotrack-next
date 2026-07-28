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
const AMOUNT_DOTTED = /(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)/; // 20,000.00, 15000.00, or -50,000.00
const AMOUNT_BIRR_RIGHT = /(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*Birr\s*$/i;
const INLINE_NAME_AMOUNT_BIRR_RIGHT =
  /^(.+?)\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*Birr\s*$/i;
const DATE_DDMMMYYYY = /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/;
const DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
// Fragmented ISO date the OCR sometimes leaves behind after chopping the
// year off ("-07-22", "-07-22 4 51 PM"). Anything that looks like this must
// never be considered an agent name.
const DATE_FRAGMENT = /^-?\d{1,4}[-/]\d{1,2}([-/]\d{1,2})?\b/;
const TIME_AMPM = /\d{1,2}:\d{2}\s*(AM|PM)/i;
// OCR frequently drops the ":" in a time, so "4:51 PM" arrives as "4 51 PM".
const TIME_LOOSE = /\b\d{1,2}\s+\d{2}\s*(AM|PM)\b/i;
const NOISE_RX =
  /^(transfers|received|sent|refill history|agents|add agent|refill|balance|home|amount|date|name|status|success|successful|pending|failed|completed|details|close|cancel|ok|back|next|previous|filter|search|total|subtotal|today|yesterday|this week|last week|all|history|export|share|print|download|menu|settings|logout|sign out|login|copy|copied)\s*$/i;
// Lines that contain no letters or digits at all (pure punctuation, icons,
// dividers, unicode bullets) are always OCR chrome. Reject wholesale.
const PURE_SYMBOL_RX = /^[^A-Za-z0-9\u1200-\u137F]+$/;
// A stray single letter/digit surrounded only by punctuation is also noise
// ("»", "· A", "0", "1.", ":", "•"). Real names and amounts always carry
// >=2 alphanumerics after cleanup.
const TOO_SHORT_RX = /^[A-Za-z0-9]$/;
// Characters OCR routinely hallucinates around real content on transfer
// screenshots. Stripped from both ends of every line during cleanLines.
//   • / · / ● / ◦ / ▪ / ■ / ◆ / ★ / ✓ / ✔ / ✕ / ✗   — bullets & status ticks
//   » / › / ▸ / ▶ / → / ← / ↩ / ⇒                    — arrows
//   © / ® / ™ / § / ¶ / † / ‡ / ¤ / ¬                — stray glyphs
//   ~ / ` / ^ / | / \ / _  (and repeated punctuation) — divider artifacts
const EDGE_NOISE_RX =
  /^[\s\u00A0\u2000-\u200F\u2028-\u202F•·●◦▪■◆★✓✔✕✗»›▸▶→←↩⇒©®™§¶†‡¤¬~`^|\\_]+|[\s\u00A0\u2000-\u200F\u2028-\u202F•·●◦▪■◆★✓✔✕✗»›▸▶→←↩⇒©®™§¶†‡¤¬~`^|\\_]+$/g;
// Names on the distributor screenshots are always alphabetic (Latin or Ethiopic
// script), with spaces / hyphens / apostrophes / dots. Any digit disqualifies
// the line — that's how we stop dates and amounts leaking into the name slot.
const NAME_RX = /^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F\s'.-]{1,58}$/;
const MONTHS_RX = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const REPEATED_SENDER_RX = /^([A-Za-z0-9._-]{3,})\s*[-–]\s*\1\b/i;

function cleanLines(text: string): string[] {
  return (
    text
      // Strip zero-width / bidi / narrow-nbsp characters before line splitting
      // so they never leak into names or amounts.
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "")
      // Normalize non-breaking spaces to plain spaces.
      .replace(/[\u00A0\u2007\u202F]/g, " ")
      .split(/\r?\n/)
      .map((l) => l.replace(EDGE_NOISE_RX, "").replace(/\s+/g, " ").trim())
      .filter((l) => {
        if (!l) return false;
        if (NOISE_RX.test(l)) return false;
        if (PURE_SYMBOL_RX.test(l)) return false;
        if (TOO_SHORT_RX.test(l)) return false;
        return true;
      })
  );
}

/**
 * Strip currency/label tokens that OCR often glues onto the end of a name
 * line (e.g. "Birukeee Birr" → "Birukeee"). Called before NAME_RX validation
 * so a stray label doesn't disqualify an otherwise-valid alphabetic name.
 */
function stripNameTrailers(line: string): string {
  return (
    line
      // Trailing status/label tokens the OCR glues onto a name.
      .replace(
        /\s+(Birr|ETB|EVD|Float|Review|Success(ful)?|Pending|Failed|Completed|Link\s+to\s+agent.*)$/i,
        "",
      )
      // Trailing bullets/arrows/ticks/punctuation OCR sprays after the name.
      .replace(/[\s\u00A0•·●◦▪■◆★✓✔✕✗»›▸▶→←⇒&*+\-–—_=|\\/`'"“”‘’(){}[\].,:;!?@#$%^~<>]+$/, "")
      .trim()
  );
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
  let out = line
    // Explicit stray leaders OCR emits on transfer cards: bullets, arrows,
    // status ticks, ampersand, single/double quotes, pipes, backticks.
    .replace(/^[\s\u00A0•·●◦▪■◆★✓✔✕✗»›▸▶→←⇒&*+\-–—_=|\\/`'"“”‘’(){}[\].,:;!?@#$%^~<>]+/, "")
    .replace(/^[^A-Za-z\u1200-\u137F]+/, "")
    .trim();
  const m = out.match(/^([A-Za-z]{1,2})\s+([A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F'.-]{2,})$/);
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
  // Reject on the ORIGINAL line first: if it carries digits, a time marker,
  // or a date fragment, no amount of leading/trailing strip can rescue it as
  // a name. This stops OCR junk like "-07-22 4 51 PM" from being reduced to
  // "PM" and then passing NAME_RX.
  if (/\d/.test(line)) return false;
  if (TIME_AMPM.test(line) || TIME_LOOSE.test(line)) return false;
  if (DATE_FRAGMENT.test(line)) return false;
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

/**
 * MJ transfer screenshots often OCR the left list index as a leading digit on
 * the sender / recipient line ("2 barisohaji - barisohaji", "5 AbdiBale").
 * Strip only that explicit ordinal shape, and only before alphabetic content,
 * so amounts/dates stay untouched.
 */
function stripTransferOrdinal(line: string): string {
  return line.replace(/^\d{1,2}\s+(?=[A-Za-z\u1200-\u137F])/, "").trim();
}

function looksLikeDateOrTime(line: string): boolean {
  return (
    DATE_ISO.test(line) ||
    TIME_AMPM.test(line) ||
    TIME_LOOSE.test(line) ||
    DATE_DDMMMYYYY.test(line) ||
    DATE_FRAGMENT.test(line)
  );
}

function parseRightAmount(line: string): string | undefined {
  const dateOnly = line.match(DATE_DDMMMYYYY);
  if (dateOnly && line.trim().endsWith(dateOnly[0])) return undefined;
  const match = line.match(new RegExp(AMOUNT_DOTTED.source + "\\s*$"));
  return match?.[1];
}

function looksLikeMjDateAmountLine(line: string): boolean {
  const amountStr = parseRightAmount(line);
  return Boolean(amountStr && DATE_DDMMMYYYY.test(line));
}

function findMjAgentAfter(
  lines: string[],
  dateAmountIndex: number,
): { agentName: string; index: number } | null {
  for (let k = dateAmountIndex + 1; k <= Math.min(lines.length - 1, dateAmountIndex + 3); k++) {
    const line = stripTransferOrdinal(lines[k]);
    if (looksLikeMjDateAmountLine(line) || REPEATED_SENDER_RX.test(line)) break;
    if (looksLikeName(line)) return { agentName: normalizeName(line), index: k };
  }
  return null;
}

function findMjSenderBefore(lines: string[], dateAmountIndex: number): string | undefined {
  for (let k = dateAmountIndex - 1; k >= Math.max(0, dateAmountIndex - 4); k--) {
    const line = stripTransferOrdinal(lines[k]);
    if (looksLikeDateOrTime(line) || parseRightAmount(line)) continue;
    if (/^(received\s+sent|sent|received)$/i.test(line)) continue;
    const repeated = line.match(REPEATED_SENDER_RX);
    if (repeated) return repeated[1];
    return line;
  }
  return undefined;
}

function hasTransfersHeading(text: string): boolean {
  return cleanLines(text).some((line) => /\btransfers?\b/i.test(line));
}

function parseInlineNameAmount(line: string): { agentName: string; amountStr: string } | null {
  const match = line.match(INLINE_NAME_AMOUNT_BIRR_RIGHT);
  if (!match) return null;
  const candidateName = normalizeName(match[1]);
  if (!looksLikeName(candidateName)) return null;
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

function hasInlineRefillRows(text: string): boolean {
  return cleanLines(text).some((line) => Boolean(parseInlineNameAmount(line)));
}

function isLikelyMjTransfers(text: string): boolean {
  const lines = cleanLines(text);
  const hasHeading = hasTransfersHeading(text);
  let cardRows = 0;
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeMjDateAmountLine(lines[i]) && findMjAgentAfter(lines, i)) cardRows++;
  }
  return cardRows >= 2 || (hasHeading && cardRows >= 1);
}

/** MJ layout — paired sender/date/agent card, right-aligned amount. */
function parseMj(text: string): StatementRow[] {
  const lines = cleanLines(text);
  const dateCardRows: StatementRow[] = [];
  const consumed = new Set<number>();

  // Primary MJ screenshot shape from the user's red annotations:
  //   <SUBDISTRIBUTOR NAME>
  //   <DATE>                                  <RIGHT-END AMOUNT>
  //   <AGENT NAME>
  // Do not require the sender to be a repeated handle; it can be any OCR text.
  for (let i = 0; i < lines.length; i++) {
    if (!looksLikeMjDateAmountLine(lines[i])) continue;
    const amountStr = parseRightAmount(lines[i]);
    const dateMatch = lines[i].match(DATE_DDMMMYYYY);
    const agent = findMjAgentAfter(lines, i);
    if (!amountStr || !dateMatch || !agent) continue;
    const santim = toSantim(amountStr);
    const sender = findMjSenderBefore(lines, i);
    dateCardRows.push({
      ok: true,
      raw: [sender, lines[i], lines[agent.index]].filter(Boolean).join(" | "),
      sender,
      dateText: dateMatch[0],
      agentName: agent.agentName,
      airtimeType: "airtime_evd",
      amountSantim: Math.abs(santim),
      isReversal: santim < 0,
      needsReview: santim < 0,
    });
    consumed.add(i);
    consumed.add(agent.index);
  }
  if (dateCardRows.length > 0) return dateCardRows;

  const out: StatementRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (consumed.has(i)) {
      i++;
      continue;
    }
    const line = stripTransferOrdinal(lines[i]);
    // Sender lines look like "barisohaji - barisohaji" (repeated handle).
    const senderM = line.match(REPEATED_SENDER_RX);
    if (!senderM) {
      i++;
      continue;
    }
    const sender = senderM[1];
    // Amount can be on the same line (right-aligned) or on the next 1-2 lines.
    let amountStr: string | undefined;
    let dateText: string | undefined;
    let agentName: string | undefined;
    amountStr = parseRightAmount(line);
    // Scan the next few lines for missing pieces + agent name.
    let j = i + 1;
    const windowEnd = Math.min(lines.length, i + 6);
    while (j < windowEnd) {
      const ln = stripTransferOrdinal(lines[j]);
      if (!dateText) {
        const dm = ln.match(DATE_DDMMMYYYY);
        if (dm) {
          dateText = dm[0];
          // Amount often shares this line, right-aligned.
          const am = parseRightAmount(ln);
          if (am && !amountStr) amountStr = am;
          j++;
          continue;
        }
      }
      if (!amountStr) {
        // Right-side amount only: whole-line number, or trailing number.
        const wholeAmount = ln.match(new RegExp("^" + AMOUNT_DOTTED.source + "$"));
        const am = wholeAmount?.[1] ?? parseRightAmount(ln);
        if (am && !DATE_DDMMMYYYY.test(ln) && !DATE_ISO.test(ln)) {
          amountStr = am;
          j++;
          continue;
        }
      }
      if (!agentName && looksLikeName(ln)) {
        // Guard: don't pick the next sender line as an agent.
        if (REPEATED_SENDER_RX.test(ln)) break;
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
  const inlineRows: StatementRow[] = [];
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
      inlineRows.push({
        ok: true,
        raw: dateText ? `${lines[i]} | ${dateText}` : lines[i],
        agentName: inline.agentName,
        dateText,
        airtimeType: "airtime_evd",
        amountSantim: Math.abs(santim),
        isReversal: santim < 0,
        needsReview: santim < 0 || !dateText,
      });
    }
  }

  // If the screenshot is the compact Refill list, the inline name+amount line
  // is the only real data row. Standalone dates, years, totals, and footer text
  // must not be interpreted as additional triplet rows.
  if (inlineRows.length > 0) return inlineRows;

  const out: StatementRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Amounts must be right-aligned "<number> Birr" at end of line — never
    // mid-line, so a date fragment can't be misread as an amount.
    const amtM = lines[i].match(AMOUNT_BIRR_RIGHT);
    if (!amtM) continue;
    // A line that also carries an ISO date or a time is a header/date band,
    // not an amount row (OCR sometimes glues "2026 Birr" onto a date line).
    if (DATE_ISO.test(lines[i]) || TIME_AMPM.test(lines[i]) || TIME_LOOSE.test(lines[i])) continue;
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

const APP_TEMPLATES: Partial<Record<DistributorStatementFormat, (text: string) => StatementRow[]>> =
  {
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
  return detectStatementTemplate(text, format).rows;
}

/** Which layout matched, and the specific rule that triggered the match. */
export type TemplateMatchKind = "mj" | "refill" | "generic";
export interface TemplateMatch {
  /** Human-readable layout label ("MJ transfers", "Refill history", "Generic"). */
  label: string;
  /** Machine-readable layout family. */
  kind: TemplateMatchKind;
  /** Short reason describing which rule fired. */
  reason: string;
  /** Whether the distributor's declared format forced the choice. */
  forced: boolean;
  /** 0–1 rough confidence based on the trigger's strength. */
  confidence: number;
  rows: StatementRow[];
}

/**
 * Same routing as parseStatementText, but also surfaces which template ran
 * and why — so the UI can show "Matched: MJ transfers · Transfers heading
 * detected" instead of a silent black box.
 */
export function detectStatementTemplate(
  text: string,
  format: DistributorStatementFormat = "generic",
): TemplateMatch {
  if (format === "generic") {
    if (hasTransfersHeading(text)) {
      return {
        label: "MJ transfers",
        kind: "mj",
        reason: 'Detected "Transfers" heading',
        forced: false,
        confidence: 0.95,
        rows: parseMj(text),
      };
    }
    if (hasInlineRefillRows(text)) {
      return {
        label: "Refill history",
        kind: "refill",
        reason: 'Detected inline "<name> <amount> Birr" row',
        forced: false,
        confidence: 0.9,
        rows: parseRefillHistory(text),
      };
    }
    if (isLikelyMjTransfers(text)) {
      return {
        label: "MJ transfers",
        kind: "mj",
        reason: "Detected ≥2 MJ card rows (date + right-amount + agent)",
        forced: false,
        confidence: 0.8,
        rows: parseMj(text),
      };
    }
    if (isLikelyRefillHistory(text)) {
      return {
        label: "Refill history",
        kind: "refill",
        reason: "Detected ≥2 name/date paired rows",
        forced: false,
        confidence: 0.75,
        rows: parseRefillHistory(text),
      };
    }
    return {
      label: "Generic",
      kind: "generic",
      reason: "No layout heuristic matched — using line-scraper fallback",
      forced: false,
      confidence: 0.3,
      rows: parseGeneric(text),
    };
  }
  const template = APP_TEMPLATES[format];
  if (template) {
    const rows = template(text);
    const kind: TemplateMatchKind = format === "mj" ? "mj" : "refill";
    const label = format === "mj" ? "MJ transfers" : "Refill history";
    return {
      label,
      kind,
      reason: `Forced by distributor format "${format}"`,
      forced: true,
      confidence: rows.some((r) => r.ok) ? 0.95 : 0.4,
      rows,
    };
  }
  return {
    label: "Generic",
    kind: "generic",
    reason: `Unknown format "${format}" — using generic scraper`,
    forced: true,
    confidence: 0.3,
    rows: parseGeneric(text),
  };
}
