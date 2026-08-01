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

/**
 * A shared item is completed only once a row was actually imported from it or
 * the operator dismissed it. Opening it, parsing it or reviewing it leaves it
 * pending, so a lock, refresh, navigation or restart resumes the same queue.
 */
export function isCompleted(item: Pick<SharedInput, "status">): boolean {
  return item.status !== "pending";
}

/** Items that must still be shown after a reload. */
export function resumableItems(items: SharedInput[]): SharedInput[] {
  return items.filter((i) => !isCompleted(i));
}

/** True when the item carries a file the screenshot/PDF importer can read. */
export function isFileInput(item: Pick<SharedInput, "kind" | "blob">): boolean {
  return !!item.blob && (item.kind === "image" || item.kind === "pdf");
}

/**
 * Turn a persisted shared Blob back into a File the existing importer accepts.
 * The bytes are reused as-is: the operator never re-uploads a shared capture.
 */
export function sharedInputToFile(
  item: Pick<SharedInput, "kind" | "blob" | "fileName" | "fileType">,
): File | null {
  if (!isFileInput(item)) return null;
  const blob = item.blob!;
  const type =
    item.fileType || blob.type || (item.kind === "pdf" ? "application/pdf" : "image/png");
  const name = item.fileName || (item.kind === "pdf" ? "shared.pdf" : "shared.png");
  return new File([blob], name, { type });
}
