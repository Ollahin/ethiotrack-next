import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SmartCapture } from "@/components/SmartCapture";
import { StatementImport } from "@/components/StatementImport";
import { addSharedInput, deleteSharedInput, setSharedInputStatus, useSharedInputs } from "@/lib/db";
import { deleteHandoff, readHandoffs } from "@/lib/share-handoff";
import { draftsFromHandoff, pendingCount } from "@/lib/share-inbox";
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
        await addSharedInput(draft);
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
    void addSharedInput({
      id: `fallback:${fallbackText.slice(0, 40)}`,
      kind: "text",
      text: fallbackText,
    });
  }, [fallbackText]);

  const pending = useMemo(() => items.filter((i) => i.status === "pending"), [items]);
  const reviewed = useMemo(() => items.filter((i) => i.status !== "pending"), [items]);
  const open = items.find((i) => i.id === openId) ?? null;

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
          : `${pendingCount(items)} waiting · ${reviewed.length} handled`}
      </div>

      {pending.length === 0 && !draining && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-ink-soft">
          Nothing waiting. Share an SMS or a screenshot to EthioTrack from your phone, or paste it
          below.
        </div>
      )}

      {pending.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {pending.map((item) => (
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

      {open?.kind === "text" && (
        <SmartCapture
          initialText={open.text ?? ""}
          onReviewed={() => void setSharedInputStatus(open.id, "reviewed")}
        />
      )}
      {open && open.kind !== "text" && (
        <div className="space-y-2">
          <div className="text-xs text-ink-soft">
            Screenshots and PDFs are read by the statement importer, which keeps the original image
            as evidence. Upload the shared file below.
          </div>
          <StatementImport />
        </div>
      )}

      {!open && <SmartCapture />}

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
