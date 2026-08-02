// Bridge between segmentation and the frozen SMS parsers.
//
// The review list must never see a row that segmentation did not accept as a
// real transaction record, so footers and help lines can no longer surface as
// "couldn't parse" pseudo-transactions.

import { parseMany, parseOne, looksLikeOcrTransferList, type ParsedRow } from "../parser";
import { segmentSourceRecords } from "./segmentation";
import { applyDirection } from "./apply-direction";

export function parseSourceRecords(text: string): ParsedRow[] {
  if (!text.trim()) return [];
  // Screenshot/OCR list text has its own reconstruction pipeline.
  if (looksLikeOcrTransferList(text)) return parseMany(text).map((r) => applyDirection(r));
  const records = segmentSourceRecords(text);
  if (records.length === 0) return [];
  const rows = records.map((r) => applyDirection(parseOne(r.raw), r.raw));
  // If segmentation produced nothing readable, fall back to the legacy
  // multi-block parser rather than silently dropping the paste.
  if (rows.every((r) => !r.ok)) return parseMany(text).map((r) => applyDirection(r));
  return rows;
}
