import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadCsv, downloadJsonBackup, importFromFile, RestoreError } from "@/lib/backup";
import { BACKUP_VERSION } from "@/lib/backup-format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/exports")({
  head: () => ({
    meta: [
      { title: "Exports · EthioTrack" },
      { name: "description", content: "Download JSON or CSV backups and restore from file." },
      { property: "og:title", content: "Exports · EthioTrack" },
      { property: "og:description", content: "Backup, restore and download your ledger." },
    ],
  }),
  component: ExportsPage,
});

function ExportsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore(file: File, replaceExisting: boolean) {
    setBusy(true);
    try {
      const res = await importFromFile(file, { replaceExisting });
      setErrors([]);
      setPendingFile(null);
      toast.success(
        `Restored ${res.transactions} transactions, ${res.agents} agents, ${res.distributors} distributors` +
          (res.migratedFromVersion ? ` (migrated from v${res.migratedFromVersion})` : ""),
      );
    } catch (e) {
      if (e instanceof RestoreError && e.needsReplaceConfirmation) {
        setPendingFile(file);
      } else if (e instanceof RestoreError) {
        setPendingFile(null);
        setErrors(e.errors);
        toast.error("Backup rejected — nothing was changed");
      } else {
        setPendingFile(null);
        setErrors([e instanceof Error ? e.message : String(e)]);
        toast.error("Restore failed — nothing was changed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">Exports & backups</h1>

      <Card
        title="Download"
        desc={`Everything stays on this device. Backup format v${BACKUP_VERSION}. Export regularly.`}
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadJsonBackup}>Download JSON backup</Button>
          <Button variant="secondary" onClick={downloadCsv}>
            Download CSV
          </Button>
        </div>
      </Card>

      <Card
        title="Restore"
        desc="Import a previously exported JSON backup. Restoring replaces this whole device account — records are never merged."
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            await restore(f, false);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          Restore from JSON
        </Button>
        {errors.length > 0 && (
          <div
            data-testid="restore-errors"
            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
          >
            <div className="font-semibold text-destructive mb-1">
              Backup rejected — no data was changed
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-ink-soft">
              {errors.slice(0, 10).map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Dialog
        open={pendingFile !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setPendingFile(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace all data on this device?</DialogTitle>
            <DialogDescription>
              This account already holds records. Restoring deletes every current transaction,
              agent, distributor, bank, import and period, then writes the backup exactly as
              exported. Nothing is merged and nothing is deduplicated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setPendingFile(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => pendingFile && restore(pendingFile, true)}
            >
              {busy ? "Restoring…" : "Replace everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-ink-soft mb-3">{desc}</div>
      {children}
    </div>
  );
}
