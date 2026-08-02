// One ingestion path for every SMS.
//
// Paste, clipboard and the Android share target all call this. The text is
// split into individual messages and each message becomes ONE persisted inbox
// row before anything is parsed. 200 pasted messages produce 200 ordered rows.

import { segmentSourceRecords } from "./segmentation";

export type InboxSource = "paste" | "clipboard" | "share";

export interface InboxSmsDraft {
  /** Stable, derived from the capture id and the position in the capture. */
  id: string;
  /** Position in the original capture — never reordered. */
  seq: number;
  text: string;
  receivedAt: string;
  origin: InboxSource;
}

export interface IngestOptions {
  /** Stable id of this capture; supply one to make ingestion idempotent. */
  captureId?: string;
  receivedAt?: string;
  origin?: InboxSource;
}

function captureId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Split a capture into its individual messages, in source order. */
export function splitSmsMessages(text: string): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  const records = segmentSourceRecords(trimmed)
    .map((r) => r.raw.trim())
    .filter(Boolean);
  // Segmentation refuses text with no money in it; that text is still kept as
  // one row so nothing a human shared can silently disappear.
  return records.length > 0 ? records : [trimmed];
}

export function ingestSmsDrafts(text: string, opts: IngestOptions = {}): InboxSmsDraft[] {
  const id = opts.captureId ?? captureId();
  const receivedAt = opts.receivedAt ?? new Date().toISOString();
  const origin = opts.origin ?? "paste";
  return splitSmsMessages(text).map((msg, seq) => ({
    id: `${id}:${seq}`,
    seq,
    text: msg,
    receivedAt,
    origin,
  }));
}

/** Inbox order: oldest capture first, and within a capture, source order. */
export function sortInboxRows<T extends { receivedAt: string; seq?: number; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
    const as = a.seq ?? 0;
    const bs = b.seq ?? 0;
    if (as !== bs) return as - bs;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}