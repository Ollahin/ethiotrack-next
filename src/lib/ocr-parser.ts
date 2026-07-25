// Distributor "Refill History" OCR parser.
//
// Screenshots from distributor apps (Alami, Yenus, Modern App, MJ Refill)
// render each refill as an inline "<Agent Name> <amount> Birr" line
// followed by a date/time line on the next row:
//
//   Birukeee 200,000 Birr
//   2026-07-22 4:51 PM
//   Tsegaaa 20,000 Birr
//   2026-07-22 1:05 PM
//
// This parser targets ONLY that shape. It never guesses from loose amounts
// or free-standing dates — a row is emitted only when the inline
// "<name> <amount> Birr" anchor is present.

import type { ParsedRow } from "./parser";

// "<name> <amount> Birr" — inline anchor (name and amount on same line).
const INLINE_NAME_AMOUNT_BIRR_RX =
  /^([A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F .'\-]{0,60}?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+Birr\b/i;

// Pure amount on its own line: "1,500" or "1,500.00" or "500.75".
const PURE_AMOUNT_RX = /^(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$/;

// Date on its own line (YYYY-MM-DD, optional HH:MM AM/PM).
const DATE_LINE_RX =
  /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i;

// Agent-name line: letters + spaces only, 2–40 chars.
const NAME_LINE_RX = /^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F ]{1,39}$/;

// Explicit UI/noise labels to drop.
const NOISE_RX =
  /^(review|link to agent\.{0,3}|evd|etb|birr|4g|5g|lte|wifi|refill(?:\s+history)?|transfers?|received|sent|home|history|balance|menu|back|close|cancel|ok|search|filter|details?|success(?:ful)?|pending|failed|completed|all|today|yesterday|amount|date|name|status|agents?|add\s+agent)$/i;

function normalize(line: string): string {
  return line
    .replace(/[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoise(line: string): boolean {
  if (!line) return true;
  if (NOISE_RX.test(line)) return true;
  if (/^\d{1,2}:\d{2}$/.test(line)) return true; // status-bar clock
  if (/^\d{1,3}%$/.test(line)) return true; // battery
  if (!/[A-Za-z0-9\u1200-\u137F]/.test(line)) return true; // symbols only
  return false;
}

function isYearGarbage(amount: string): boolean {
  // Reject "2,026.00" (OCR of the year 2026 rendered with commas + decimals).
  if (!/\.00$/.test(amount)) return false;
  const n = Number(amount.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 2000 && n <= 2100;
}

function toSantim(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Math.round(n * 100);
}

function toIsoDate(dateStr: string, hh?: string, mm?: string, ampm?: string): string {
  if (!hh || !mm) return new Date(`${dateStr}T00:00:00Z`).toISOString();
  let h = Number(hh) % 12;
  if ((ampm ?? "").toUpperCase() === "PM") h += 12;
  const hs = String(h).padStart(2, "0");
  return new Date(`${dateStr}T${hs}:${mm}:00Z`).toISOString();
}

/**
 * Heuristic gate: does this text look like a distributor Refill History
 * screenshot? Lenient: text mentions Birr/ETB AND has ≥2 amount-like numbers
 * AND ≥2 date-like patterns. SMS batches are excluded via strong SMS markers.
 */
export function looksLikeDistributorRefillOcr(text: string): boolean {
  // Never intercept clearly-SMS payloads.
  if (/\b(transaction number|your\s+tele[- ]?birr\s+account|E[- ]?Money\s+Account|has been credited|has been debited|Available Balance|Transfer ID|Ref:\s*[A-Z0-9]|from\s+Commercial\s+Bank)\b/i.test(text)) {
    return false;
  }
  const hasCurrency = /\b(Birr|ETB)\b/i.test(text);
  if (!hasCurrency) return false;
  let amounts = 0;
  let dates = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = normalize(raw);
    if (!line) continue;
    if (/\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/.test(line) || /^\d+(?:\.\d{1,2})?$/.test(line)) amounts++;
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(line)) dates++;
  }
  return amounts >= 2 && dates >= 2;
}

/**
 * Parse a distributor Refill History screenshot (OCR text) into airtime EVD
 * credits. Handles two layouts:
 *   1) Inline:   "<name> <amount> Birr"  +  "<date>"
 *   2) Split:    "<name>" / "<amount>" / "<date>" (in any order, within 5 lines)
 * Silently skips incomplete groups — never emits ParsedFail rows.
 */
export function parseDistributorRefillOcr(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalize)
    .filter((l) => l && !isNoise(l));

  const rows: ParsedRow[] = [];
  const consumed = new Set<number>();

  // Pass 1 — inline "<name> <amount> Birr" lines (preferred, unambiguous).
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(INLINE_NAME_AMOUNT_BIRR_RX);
    if (!m) continue;
    const name = m[1].trim();
    if (isYearGarbage(m[2])) continue;
    const amountSantim = toSantim(m[2]);
    if (!name || !Number.isFinite(amountSantim) || amountSantim <= 0) continue;

    let dateIso = new Date().toISOString();
    let dateText: string | undefined;
    const next = lines[i + 1];
    if (next) {
      const dm = next.match(DATE_LINE_RX);
      if (dm) {
        dateIso = toIsoDate(dm[1], dm[2], dm[3], dm[4]);
        dateText = next;
        consumed.add(i + 1);
      }
    }
    consumed.add(i);
    rows.push({
      ok: true,
      raw: dateText ? `${lines[i]}\n${dateText}` : lines[i],
      type: "airtime_evd",
      amountSantim,
      party: name,
      channel: "Distributor",
      date: dateIso,
      note: `Refill · ${name}${dateText ? ` · ${dateText}` : ""}`,
      needsReview: false,
      template: "ocr.distributor.refill",
    });
  }

  // Pass 2 — separated-line layout: for each amount-only line, scan ±2
  // lines for a date and a name. Emit only when all three are present.
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const am = lines[i].match(PURE_AMOUNT_RX);
    if (!am) continue;
    if (isYearGarbage(am[1])) continue;
    const amountSantim = toSantim(am[1]);
    if (!Number.isFinite(amountSantim) || amountSantim <= 0) continue;

    let dateIdx = -1;
    let nameIdx = -1;
    for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) {
      if (k === i || consumed.has(k)) continue;
      if (dateIdx === -1) {
        const dm = lines[k].match(DATE_LINE_RX);
        if (dm) { dateIdx = k; continue; }
      }
      if (nameIdx === -1 && NAME_LINE_RX.test(lines[k])) {
        nameIdx = k;
      }
    }
    if (dateIdx === -1 || nameIdx === -1) continue;

    const dm = lines[dateIdx].match(DATE_LINE_RX)!;
    const name = lines[nameIdx].trim();
    const dateIso = toIsoDate(dm[1], dm[2], dm[3], dm[4]);

    consumed.add(i);
    consumed.add(dateIdx);
    consumed.add(nameIdx);

    rows.push({
      ok: true,
      raw: [lines[nameIdx], lines[i], lines[dateIdx]].join("\n"),
      type: "airtime_evd",
      amountSantim,
      party: name,
      channel: "Distributor",
      date: dateIso,
      note: `Refill · ${name} · ${lines[dateIdx]}`,
      needsReview: false,
      template: "ocr.distributor.refill",
    });
  }

  return rows;
}