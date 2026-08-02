import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SmsInbox } from "@/components/SmsInbox";
import { StatementImport } from "@/components/StatementImport";
import {
  addSharedInput,
  addSmsInboxRows,
  deleteSharedInput,
  setSharedInputStatus,
  useSharedInputs,
} from "@/lib/db";
import { deleteHandoff, readHandoffs } from "@/lib/share-handoff";
import { draftsFromHandoff, isFileInput, sharedInputToFile } from "@/lib/share-inbox";
import { ingestSmsDrafts } from "@/lib/capture/inbox-ingest";
import type { SharedInput } from "@/lib/types";
import { formatTxnDate } from "@/lib/format";

export const Route = createFileRoute("/inbox")({
  validateSearch: (search: Record<string, unknown>) => ({
    text: typeof search.text === "string" ? search.text : undefined,
    fallback: search.fallback === "1" || search.fallback === 1 ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shared inbox · EthioTrack" },
      {
        name: "description",
        content:
          "Messages and screenshots shared from your phone, waiting to be reviewed before anything is saved.",
      },
      { property: "og:title", content: "Shared inbox · EthioTrack" },
      {
        property: "og:description",
        content: "Review shared bank messages and airtime screenshots before saving them.",
      },
    ],
  }),
  component: InboxPage,
});

function InboxPage() {
  const { text: fallbackText, fallback } = Route.useSearch();
  const items = useSharedInputs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draining, setDraining] = useState(true);

  const drain = useCallback(async () => {
    const records = await readHandoffs();
    for (const record of records) {
      for (const draft of draftsFromHandoff(record)) {
        // Shared text takes the identical path as a paste: one inbox row per
        // message, before anything is parsed.
        if (draft.kind === "text" && draft.text) {
          await addSmsInboxRows(
            ingestSmsDrafts(draft.text, {
              captureId: draft.id,
              receivedAt: draft.receivedAt,
              origin: "share",
            }),
          );
        } else {
          await addSharedInput(draft);
        }
      }
      await deleteHandoff(record.id);
    }
    setDraining(false);
  }, []);

  useEffect(() => {
    void drain();
  }, [drain]);

  // A share that reached the server instead of the worker still lands here.
  useEffect(() => {
    if (!fallbackText) return;
    void addSmsInboxRows(
      ingestSmsDrafts(fallbackText, {
        captureId: `fallback:${fallbackText.slice(0, 40)}`,
        origin: "share",
      }),
    );
  }, [fallbackText]);

  // Text lives in the SMS inbox below; only shared files still need their own
  // open/review row here.
  const pendingFiles = useMemo(
    () => items.filter((i) => i.status === "pending" && i.kind !== "text"),
    [items],
  );
  const reviewed = useMemo(() => items.filter((i) => i.status !== "pending"), [items]);
  const open = items.find((i) => i.id === openId) ?? null;
  // The stored bytes are reused as-is; the operator never re-uploads a share.
  const openFile = useMemo(() => (open ? sharedInputToFile(open) : null), [open]);
  const openFiles = useMemo(() => (openFile ? [openFile] : undefined), [openFile]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Shared inbox</h1>
        <p className="text-sm text-ink-soft">
          Everything shared from your phone waits here untouched. Nothing is parsed, linked or saved
          until you open it.
        </p>
      </div>

      {fallback && (
        <div className="rounded-md border border-airtime/40 bg-airtime/5 p-2 text-xs text-airtime">
          This share arrived before the app's share handler was ready. Text was kept; any attached
          file was not — share the file again.
        </div>
      )}

      <div className="text-xs text-ink-soft">
        {draining
          ? "Checking for new shares…"
          : `${pendingFiles.length} shared file(s) waiting · ${reviewed.length} handled`}
      </div>

      {pendingFiles.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {pendingFiles.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              isOpen={openId === item.id}
              onOpen={() => setOpenId(openId === item.id ? null : item.id)}
              onDismiss={() => void setSharedInputStatus(item.id, "dismissed")}
              onDelete={() => void deleteSharedInput(item.id)}
            />
          ))}
        </ul>
      )}

      {open && open.kind !== "text" && isFileInput(open) && openFiles && (
        <div className="space-y-2">
          <div className="text-xs text-ink-soft">
            The shared {open.kind === "pdf" ? "PDF" : "screenshot"} is being read below from the
            file you already shared — nothing to upload again. The original is kept as evidence.
          </div>
          <StatementImport
            key={open.id}
            initialFiles={openFiles}
            hideDropzone
            onSaved={() => void setSharedInputStatus(open.id, "reviewed")}
          />
        </div>
      )}
      {open && open.kind !== "text" && !isFileInput(open) && (
        <div className="rounded-md border border-money-out/40 bg-money-out/5 p-3 text-xs text-money-out">
          This share arrived without readable file data. Share it again from your phone, or paste
          its text below.
        </div>
      )}

      <SmsInbox />

      {reviewed.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer p-2 text-xs text-ink-soft">
            {reviewed.length} handled share(s)
          </summary>
          <ul className="divide-y divide-border">
            {reviewed.map((item) => (
              <li key={item.id} className="p-2 text-xs flex items-center gap-2">
                <span className="text-ink-soft">{formatTxnDate(item.receivedAt, false)}</span>
                <span className="truncate">{item.text ?? item.fileName ?? "shared file"}</span>
                <span className="ml-auto uppercase text-[10px] text-ink-soft">{item.status}</span>
                <Button size="sm" variant="ghost" onClick={() => void deleteSharedInput(item.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function InboxRow({
  item,
  isOpen,
  onOpen,
  onDismiss,
  onDelete,
}: {
  item: SharedInput;
  isOpen: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={"p-2 space-y-1 " + (isOpen ? "bg-muted/40" : "")}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase font-semibold rounded bg-muted px-1.5 py-0.5">
          {item.kind}
        </span>
        <span className="text-xs text-ink-soft">{formatTxnDate(item.receivedAt, false)}</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={isOpen ? "secondary" : "default"} onClick={onOpen}>
            {isOpen ? "Close" : "Review"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <div className="text-xs whitespace-pre-wrap break-words text-ink-soft">
        {item.text ?? item.fileName ?? "shared file"}
      </div>
    </li>
  );
}
