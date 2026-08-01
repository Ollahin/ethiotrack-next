// src/lib/ocr-parser.ts
// OCR row extraction for distributor "Refill History" and bank "Transfers"
// list screenshots.
//
// The legacy date-anchored backtracking scraper (scan backwards up to 6 lines
// for an amount, then for a name, then drop duplicates by party+amount+day)
// has been deleted. Extraction is delegated to the generic, position-aware
// evidence engine in `ocr-row-reconstruction.ts`, which anchors one row per
// defensible amount, consumes each piece of evidence at most once, preserves
// source order and repeated legitimate rows, and abstains instead of
// borrowing a missing party or date from a neighbouring row.

import type { ParsedRow } from "./parser";
import { reconstructRows, type ReconstructedRow } from "./ocr-row-reconstruction";

// ── Re-export santim helper ────────────────────────────────────────────────
export function toSantim(s: string): number {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  return Math.round(n * 100);
}

/**
 * Generic detector for the "<name> - <name>" subdistributor account label
 * pattern that MJ-style transfer screenshots print at the top of every row.
 * We split only on the hyphen/en-dash separator, trim + collapse whitespace,
 * compare case-insensitively, and require both sides to be non-empty and
 * equal after normalization. No private literal is used.
 */
export function isRepeatedHandleLabel(line: string): boolean {
  const norm = line.replace(/\s+/g, " ").trim();
  // Split on a single hyphen or en-dash surrounded by optional whitespace.
  const parts = norm.split(/\s*[-–]\s*/);
  if (parts.length !== 2) return false;
  const [left, right] = parts;
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

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

/** ISO timestamp for evidence text, or null — never a defaulted "now". */
function evidenceDateIso(text: string | undefined): string | null {
  if (!text) return null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(text);
  if (iso) {
    let hour = iso[4] ? Number(iso[4]) : 0;
    const minute = iso[5] ? Number(iso[5]) : 0;
    const ap = iso[6]?.toUpperCase();
    if (ap === "PM" && hour !== 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), hour, minute);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const dmy = /\b(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})\b/.exec(text);
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()];
    if (month === undefined) return null;
    const d = new Date(Number(dmy[3]), month, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function toParsedRow(
  row: ReconstructedRow,
  type: "airtime_evd" | "out",
  template: string,
): ParsedRow {
  const date = evidenceDateIso(row.dateText);
  if (!row.agentName || !date) {
    return {
      ok: false,
      raw: row.raw || `${template}#${row.sourceOrder}`,
      reason: !row.agentName ? "no party evidence" : "no date evidence",
    };
  }
  return {
    ok: true,
    type,
    amountSantim: row.amountSantim,
    party: row.agentName,
    channel: "Other",
    date,
    note: `${type === "airtime_evd" ? "EVD refill" : "Transfer"} to ${row.agentName} — ${new Date(
      date,
    ).toLocaleString("en-GB")}`,
    template,
    needsReview: row.isReversal,
    raw: row.raw,
  };
}

// ── Public API: Distributor Refill ─────────────────────────────────────────
export function parseDistributorRefillOcr(text: string): ParsedRow[] {
  return reconstructRows(text).rows.map((r) =>
    toParsedRow(r, "airtime_evd", "ocr.distributor.refill"),
  );
}

export function looksLikeDistributorRefillOcr(text: string): boolean {
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
  // Repeated-handle account labels are never a counterparty.
  return reconstructRows(text)
    .rows.map((r) =>
      r.agentName && isRepeatedHandleLabel(r.agentName)
        ? { ...r, agentName: undefined, complete: false }
        : r,
    )
    .map((r) => toParsedRow(r, "out", "ocr.bank.transfer"));
}

export function looksLikeBankTransferOcr(text: string): boolean {
  const hasTransfers = /\btransfers\b/i.test(text) || /\bsent\b/i.test(text);
  const dateMatches = text.match(/\d{1,2}\s+[A-Za-z]{3,4}\s+\d{4}/g);
  const hasMultipleDates = dateMatches ? dateMatches.length >= 2 : false;
  const hasAmounts = (text.match(/\d{1,3}(?:,\d{3})*(?:\.\d{2})/g) || []).length >= 2;
  return hasTransfers && hasMultipleDates && hasAmounts && text.length > 100;
}
