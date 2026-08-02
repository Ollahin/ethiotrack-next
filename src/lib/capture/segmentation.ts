// Message segmentation.
//
// One SMS stays one source record. Footers, help lines, slogans, balances,
// URLs and feedback links are NEVER promoted to their own transaction: they
// are kept inside the raw evidence of the record they belong to. A record is
// split only on a defensible transaction boundary.

import { segmentCbeTransfers } from "../cbe-transfer-parser";

export interface SourceRecord {
  index: number;
  /** Full text of the record, footers included. */
  raw: string;
  /** Lines kept as evidence but recognised as non-transactional. */
  attachments: string[];
}

const MONEY_RX = /(?:ETB|Birr|ብር)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:ETB|Birr|ብር)/i;

/** Verbs that make a line a money movement rather than a footer or a balance. */
const MOVEMENT_RX =
  /\b(?:credited|debited|transferred|transfered|received|sent|paid|recharged|purchased|withdraw\w*|deposit\w*|added to|removed from|settle\w*)\b|\bተላልፏል\b|\bደርሶዎታል\b/i;

/**
 * Lines that surround real content: help desks, slogans, feedback links, bare
 * URLs, "thank you" signoffs, balance-only lines.
 */
const ATTACHMENT_RX =
  /^(?:\s*(?:https?:\/\/|www\.)\S+\s*$)|thank you|thanks for|for (?:more )?(?:info|information|help)|call\s*\d{3,}|dial\s*\*\d+|customer (?:service|care)|feedback|to (?:opt|unsubscribe)|terms and conditions|download the app|dear\s+customer\s*[,:.]?\s*$|^\s*regards\b|^\s*sincerely\b/i;

const BALANCE_ONLY_RX = /^(?:your\s+)?(?:current|available|ledger|e-?money)?\s*balance\b[^.]*$/i;

export function isAttachmentLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (ATTACHMENT_RX.test(t)) return true;
  if (BALANCE_ONLY_RX.test(t)) return true;
  return false;
}

/** A line that can stand on its own as a transaction. */
export function isTransactionLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isAttachmentLine(t)) return false;
  return MONEY_RX.test(t) && MOVEMENT_RX.test(t);
}

function makeRecord(index: number, raw: string): SourceRecord {
  const attachments = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && isAttachmentLine(l));
  return { index, raw: raw.trim(), attachments };
}

/**
 * Split a block into records only where a new transaction demonstrably starts.
 * Everything between two starts — including footers — belongs to the earlier
 * record.
 */
function splitBlock(block: string): string[] {
  const lines = block.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (isTransactionLine(l)) starts.push(i);
  });
  if (starts.length < 2) return [block];
  const chunks: string[] = [];
  if (starts[0] > 0) {
    // Leading context (greeting/header) belongs to the first transaction.
    starts[0] = 0;
  }
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const chunk = lines.slice(from, to).join("\n").trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/**
 * Segment a raw capture into source records. Never returns a record that has
 * no transactional content of its own.
 */
export function segmentSourceRecords(text: string): SourceRecord[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];

  // CBE outgoing transfers wrap mid-sentence; their own grammar owns the split.
  const cbe = segmentCbeTransfers(raw);
  if (cbe && cbe.length > 0) return cbe.map((seg, i) => makeRecord(i, seg));

  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const block of blocks) {
    if (!MONEY_RX.test(block) && pieces.length > 0) {
      // A trailing footer block is evidence for the previous record.
      pieces[pieces.length - 1] = `${pieces[pieces.length - 1]}\n${block}`;
      continue;
    }
    for (const chunk of splitBlock(block)) pieces.push(chunk);
  }
  if (pieces.length === 0) return [makeRecord(0, raw)];
  return pieces.map((p, i) => makeRecord(i, p));
}
