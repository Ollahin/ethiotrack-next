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

// "<name> <amount> Birr" with the amount right-anchored to the "Birr" label.
// Name is alphabetic (Latin or Ethiopic), may contain spaces and a few
// common punctuation marks; amount is a grouped integer, no decimals.
const INLINE_NAME_AMOUNT_BIRR_RX =
  /^([A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F .'\-]{0,60}?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+Birr\b/i;

// Date/time on its own line (YYYY-MM-DD, optional HH:MM AM/PM).
const DATE_LINE_RX =
  /^\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?\s*$/i;

function normalize(line: string): string {
  return line
    .replace(/[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
 * screenshot? True when we find ≥2 inline "<name> <amount> Birr" lines.
 */
export function looksLikeDistributorRefillOcr(text: string): boolean {
  let hits = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (INLINE_NAME_AMOUNT_BIRR_RX.test(normalize(raw))) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/**
 * Parse a distributor Refill History screenshot (OCR text) into airtime EVD
 * credits. Silently skips lines that don't match the inline anchor —
 * never emits ParsedFail rows.
 */
export function parseDistributorRefillOcr(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map(normalize).filter(Boolean);
  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(INLINE_NAME_AMOUNT_BIRR_RX);
    if (!m) continue;
    const name = m[1].trim();
    const amountSantim = toSantim(m[2]);
    if (!name || !Number.isFinite(amountSantim) || amountSantim <= 0) continue;

    // Look for a date/time on the very next line (most common layout).
    let dateIso = new Date().toISOString();
    let dateText: string | undefined;
    const next = lines[i + 1];
    if (next) {
      const dm = next.match(DATE_LINE_RX);
      if (dm) {
        dateIso = toIsoDate(dm[1], dm[2], dm[3], dm[4]);
        dateText = next;
      }
    }

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
  return rows;
}