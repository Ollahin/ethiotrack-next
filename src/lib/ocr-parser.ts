// src/lib/ocr-parser.ts
// BULLETPROOF parser for distributor "Refill History" and bank "Transfers" OCR.
// Handles: inline agent+amount, separated lines, mangled OCR, negative amounts.

import type { ParsedOk, ParsedRow } from "./parser";

// Internal refined type: rows produced by the OCR extractor always carry a
// concrete `date` (ISO string) and `party` (agent name), even though those
// fields are optional on the public `ParsedOk` shape.
type CompleteOcrParsedRow = ParsedOk & {
  date: string;
  party: string;
};

// ── Re-export santim helper ────────────────────────────────────────────────
export function toSantim(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  return Math.round(n * 100);
}

// ── Date parsing ───────────────────────────────────────────────────────────
function parseDateLine(line: string): Date | null {
  // YYYY-MM-DD H:MM AM/PM
  const m1 = line.match(/\b(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (m1) {
    let h = parseInt(m1[4], 10);
    const ampm = m1[6].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const d = new Date(
      parseInt(m1[1], 10),
      parseInt(m1[2], 10) - 1,
      parseInt(m1[3], 10),
      h,
      parseInt(m1[5], 10),
    );
    if (!isNaN(d.getTime())) return d;
  }
  // YYYY-MM-DDH:MM AM/PM (no space between date and time — mangled OCR)
  const m1b = line.match(/\b(\d{4})-(\d{2})-(\d{2})(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (m1b) {
    let h = parseInt(m1b[4], 10);
    const ampm = m1b[6].toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const d = new Date(
      parseInt(m1b[1], 10),
      parseInt(m1b[2], 10) - 1,
      parseInt(m1b[3], 10),
      h,
      parseInt(m1b[5], 10),
    );
    if (!isNaN(d.getTime())) return d;
  }
  // DD MMM YYYY
  const MONTHS: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const m2 = line.match(/\b(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})\b/);
  if (m2) {
    const mo = MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      const d = new Date(parseInt(m2[3], 10), mo, parseInt(m2[1], 10));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ── Amount parsing ─────────────────────────────────────────────────────────
function parseAmountLine(
  line: string,
): { amount: number; isNegative: boolean; raw: string } | null {
  // Match amount with optional negative sign, optional "Birr" or "ETB"
  const m = line.match(/(-?)(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(?:Birr|ETB)?/i);
  if (!m) return null;

  const raw = m[2];
  const clean = raw.replace(/,/g, "");
  const n = parseFloat(clean);
  if (isNaN(n) || n <= 0) return null;

  // Reject obvious years masquerading as amounts
  if (n >= 2000 && n <= 2100 && raw.endsWith(".00")) return null;

  return {
    amount: Math.round(n * 100),
    isNegative: m[1] === "-",
    raw,
  };
}

// ── Agent name validation ──────────────────────────────────────────────────
function stripTrailingGarbage(s: string): string {
  // Remove trailing punctuation and OCR artifacts
  return s.replace(/[.,"'\-\s]+$/g, "").trim();
}

function isAgentName(line: string): boolean {
  const clean = stripTrailingGarbage(line);
  if (clean.length < 2 || clean.length > 40) return false;
  // Must contain at least 2 letters
  if ((clean.match(/[A-Za-z]/g) || []).length < 2) return false;
  // Reject sender names, UI labels, pure numbers
  if (/\bbariso/i.test(clean)) return false;
  if (/\bhaji\b/i.test(clean)) return false;
  if (
    /\b(Refill History|Agents|Add Agent|Refill|Review|Link to agent|EVD|Sent|Received|Transfers|Birr|ETB)\b/i.test(
      clean,
    )
  )
    return false;
  if (/^\d+$/.test(clean)) return false;
  if (/^\d{1,2}%$/.test(clean)) return false;
  if (/^\d{1,2}:\d{2}/.test(clean)) return false;
  if (/^4G$|^5G$|^LTE$/i.test(clean)) return false;
  // Allow letters, spaces, and limited punctuation
  return /^[A-Za-z\s.'-]+$/.test(clean);
}

// ── Noise removal ──────────────────────────────────────────────────────────
function cleanLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[=–—-]+$/.test(l))
    .filter((l) => !/^→\s*/.test(l))
    .filter((l) => !/^\d{1,2}%$/.test(l))
    .filter((l) => !/^\d{1,2}:\d{2}$/.test(l))
    .filter((l) => !/^4G$|^5G$|^LTE$/i.test(l))
    .filter((l) => !/\b(Refill History|Agents|Add Agent|Refill|Sent|Received|Transfers)\b/i.test(l))
    .filter((l) => l !== "Birr" && l !== "ETB");
}

// ── Core extraction: find all transactions by anchoring on dates ───────────
function extractByDateAnchors(
  lines: string[],
  type: "airtime_evd" | "out",
  template: string,
): CompleteOcrParsedRow[] {
  const results: CompleteOcrParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const date = parseDateLine(lines[i]);
    if (!date) continue;

    // Look backward up to 6 lines for amount and agent
    let bestAmount: { amount: number; isNegative: boolean; raw: string } | null = null;
    let bestAmountIdx = -1;
    let bestAgent: string | null = null;
    let bestAgentIdx = -1;

    const scanStart = Math.max(0, i - 6);

    // First pass: find the nearest amount before this date
    for (let j = i - 1; j >= scanStart; j--) {
      const amt = parseAmountLine(lines[j]);
      if (amt) {
        bestAmount = amt;
        bestAmountIdx = j;
        break;
      }
    }

    if (!bestAmount) continue;

    // Second pass: find the nearest agent before the amount
    for (let j = bestAmountIdx - 1; j >= scanStart; j--) {
      if (isAgentName(lines[j])) {
        bestAgent = stripTrailingGarbage(lines[j]);
        bestAgentIdx = j;
        break;
      }
    }

    // If no agent found before amount, check if agent is ON the same line as amount
    if (!bestAgent) {
      const sameLine = lines[bestAmountIdx];
      // Remove the amount part and see if remainder is an agent name
      const withoutAmount = sameLine
        .replace(/(-?)(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(?:Birr|ETB)?/i, "")
        .trim();
      const stripped = stripTrailingGarbage(withoutAmount);
      if (stripped && isAgentName(stripped)) {
        bestAgent = stripped;
        bestAgentIdx = bestAmountIdx;
      }
    }

    // If still no agent, check the line immediately AFTER the date (some OCR puts agent below)
    if (!bestAgent && i + 1 < lines.length) {
      const next = stripTrailingGarbage(lines[i + 1]);
      if (next && isAgentName(next)) {
        bestAgent = next;
        bestAgentIdx = i + 1;
      }
    }

    if (!bestAgent) continue;

    // Build raw context
    const contextStart = Math.max(0, bestAgentIdx - 1);
    const contextEnd = Math.min(lines.length, i + 2);
    const raw = lines.slice(contextStart, contextEnd).join("\n");

    results.push({
      ok: true,
      type,
      amountSantim: bestAmount.amount,
      party: bestAgent,
      channel: "Other",
      date: date.toISOString(),
      note: `${type === "airtime_evd" ? "EVD refill" : "Transfer"} to ${bestAgent} — ${date.toLocaleString("en-GB")}`,
      template,
      needsReview: bestAmount.isNegative || bestAmount.amount < 1_000_00,
      raw,
    });
  }

  // Deduplicate: same party + same amount + same day
  const seen = new Set<string>();
  return results.filter((r) => {
    const day = r.date.slice(0, 10);
    const key = `${r.party}|${r.amountSantim}|${day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Public API: Distributor Refill ─────────────────────────────────────────
export function parseDistributorRefillOcr(text: string): ParsedRow[] {
  const lines = cleanLines(text);
  return extractByDateAnchors(lines, "airtime_evd", "ocr.distributor.refill");
}

export function looksLikeDistributorRefillOcr(text: string): boolean {
  const t = text.toLowerCase();
  const hasBirr = /\bbirr\b/i.test(text);
  const dateMatches = text.match(/\d{4}-\d{2}-\d{2}/g);
  const hasMultipleDates = dateMatches ? dateMatches.length >= 2 : false;
  const hasSmsKeywords =
    /\b(credited|debited|your current balance|transaction number|account has been|transfer id)\b/i.test(
      text,
    );
  return hasBirr && hasMultipleDates && !hasSmsKeywords && text.length > 80;
}

// ── Public API: Bank Transfer (Sent tab) ───────────────────────────────────
export function parseBankTransferOcr(text: string): ParsedRow[] {
  const lines = cleanLines(text);
  // For bank transfers, we also need to reject "barisohaji" lines as agents
  // but we still use the same date-anchor approach
  const results = extractByDateAnchors(lines, "out", "ocr.bank.transfer");
  // Additional filter: ensure we don't have barisohaji as party
  return results.filter((r) => !/bariso/i.test(r.party));
}

export function looksLikeBankTransferOcr(text: string): boolean {
  const t = text.toLowerCase();
  const hasTransfers = /\btransfers\b/i.test(text) || /\bsent\b/i.test(text);
  const dateMatches = text.match(/\d{1,2}\s+[A-Za-z]{3,4}\s+\d{4}/g);
  const hasMultipleDates = dateMatches ? dateMatches.length >= 2 : false;
  const hasAmounts = (text.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})/g) || []).length >= 2;
  return hasTransfers && hasMultipleDates && hasAmounts && text.length > 100;
}
