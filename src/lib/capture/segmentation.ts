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

/**
 * Defensible openings of a NEW message inside a pasted batch: a greeting, a
 * "Dear Customer" salutation, or an explicit account-action opening. These are
 * message starts, never transactions in their own right.
 */
const MESSAGE_START_RX =
  /^(?:dear\s+[\w'’.\- ]{2,40}[,:]?\s*$|dear\s+(?:customer|valued|client)\b|hello\b|hi\b|greetings\b)/i;

/** A bare receipt/verification URL terminates the message that produced it. */
const URL_LINE_RX = /^(?:https?:\/\/|www\.)\S+$/i;

export function isMessageStartLine(line: string): boolean {
  return MESSAGE_START_RX.test(line.trim());
}

export function isUrlTerminatorLine(line: string): boolean {
  return URL_LINE_RX.test(line.trim());
}

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
  const mark = (i: number) => {
    if (i > 0 && i < lines.length && !starts.includes(i)) starts.push(i);
    if (i === 0 && !starts.includes(0)) starts.push(0);
  };
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    // A transaction clause or an explicit greeting both open a message.
    if (isTransactionLine(l) || isMessageStartLine(l)) mark(i);
    // Everything after a receipt URL belongs to the next message.
    if (isUrlTerminatorLine(l)) {
      const next = lines.findIndex((n, k) => k > i && n.trim().length > 0);
      if (next > 0) mark(next);
    }
  });
  starts.sort((a, b) => a - b);
  if (starts.length < 2) return [block];
  // Leading context (header/greeting) belongs to the first message.
  starts[0] = 0;
  const chunks: string[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const chunk = lines.slice(from, to).join("\n").trim();
    if (chunk) chunks.push(chunk);
  }
  return mergeNonTransactional(chunks);
}

/**
 * A chunk with no money in it is never a transaction: it is a header for the
 * message that follows or a footer of the message before it. Merging here is
 * what keeps footers, slogans and URLs attached to their own SMS instead of
 * becoming candidates.
 */
function mergeNonTransactional(chunks: string[]): string[] {
  const out: string[] = [];
  let pendingHeader = "";
  for (const chunk of chunks) {
    if (!MONEY_RX.test(chunk)) {
      // A greeting opens the NEXT message; anything else closes the previous.
      const opensNext = isMessageStartLine(chunk.split(/\r?\n/)[0] ?? "");
      if (!opensNext && out.length > 0) out[out.length - 1] = `${out[out.length - 1]}\n${chunk}`;
      else pendingHeader = pendingHeader ? `${pendingHeader}\n${chunk}` : chunk;
      continue;
    }
    out.push(pendingHeader ? `${pendingHeader}\n${chunk}` : chunk);
    pendingHeader = "";
  }
  if (out.length === 0 && pendingHeader) out.push(pendingHeader);
  return out;
}

/**
 * Segment a raw capture into source records. Never returns a record that has
 * no transactional content of its own.
 */
export function segmentSourceRecords(text: string): SourceRecord[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];

  const blocks = raw
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let header = "";
  for (const block of blocks) {
    if (!MONEY_RX.test(block)) {
      // A greeting block opens the next message; any other money-free block is
      // a footer of the message before it.
      if (isMessageStartLine(block.split(/\r?\n/)[0] ?? "") || pieces.length === 0) {
        header = header ? `${header}\n${block}` : block;
      } else {
        pieces[pieces.length - 1] = `${pieces[pieces.length - 1]}\n${block}`;
      }
      continue;
    }
    for (const chunk of splitBlock(block)) {
      pieces.push(header ? `${header}\n${chunk}` : chunk);
      header = "";
    }
  }
  if (header && pieces.length > 0) pieces[pieces.length - 1] += `\n${header}`;
  if (pieces.length === 0) return [makeRecord(0, raw)];

  // CBE outgoing transfers wrap mid-sentence; their own grammar owns the split
  // WITHIN a piece, so it can never swallow neighbouring messages.
  const expanded: string[] = [];
  for (const piece of pieces) {
    const cbe = segmentCbeTransfers(piece);
    if (cbe && cbe.length > 0) expanded.push(...cbe);
    else expanded.push(piece);
  }
  return expanded.map((p, i) => makeRecord(i, p));
}
