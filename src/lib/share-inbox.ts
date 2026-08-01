// Pure share-inbox rules: how a raw handoff record becomes an inbox item.
import type { SharedInput } from "./types";
import { classifyCapturedFile, type CaptureFileKind } from "./smart-capture";
import type { HandoffRecord } from "./share-handoff";

export interface InboxDraft {
  id: string;
  receivedAt: string;
  kind: SharedInput["kind"];
  title?: string;
  text?: string;
  fileName?: string;
  fileType?: string;
  blob?: Blob;
  error?: string;
}

function kindFor(file: { type?: string; name?: string } | undefined): CaptureFileKind | "text" {
  if (!file) return "text";
  return classifyCapturedFile(file);
}

/**
 * One handoff can carry several files plus a text body. Each becomes its own
 * inbox item so an operator reviews (and can dismiss) them independently.
 * Ids are derived from the handoff id, so a replayed drain never duplicates.
 */
export function draftsFromHandoff(record: HandoffRecord): InboxDraft[] {
  const drafts: InboxDraft[] = [];
  const files = record.files ?? [];
  files.forEach((f, i) => {
    const kind = kindFor(f);
    drafts.push({
      id: `${record.id}:f${i}`,
      receivedAt: record.receivedAt,
      kind: kind === "text" ? "text" : kind === "unsupported" ? "unsupported" : kind,
      title: record.title,
      fileName: f.name,
      fileType: f.type,
      blob: f.blob,
    });
  });
  if (record.text && record.text.trim()) {
    drafts.push({
      id: `${record.id}:t`,
      receivedAt: record.receivedAt,
      kind: "text",
      title: record.title,
      text: record.text,
    });
  }
  if (drafts.length === 0) {
    drafts.push({
      id: `${record.id}:empty`,
      receivedAt: record.receivedAt,
      kind: "unsupported",
      title: record.title,
      error: record.error ?? "The share arrived with no text and no readable file.",
    });
  }
  return drafts;
}

export function pendingCount(items: SharedInput[]): number {
  return items.filter((i) => i.status === "pending").length;
}
