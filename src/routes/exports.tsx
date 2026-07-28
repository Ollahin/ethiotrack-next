import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { downloadCsv, downloadJsonBackup, importFromFile } from "@/lib/backup";
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
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">Exports & backups</h1>

      <Card title="Download" desc="Everything stays on this device. Export regularly.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadJsonBackup}>Download JSON backup</Button>
          <Button variant="secondary" onClick={downloadCsv}>
            Download CSV
          </Button>
        </div>
      </Card>

      <Card title="Restore" desc="Import a previously exported JSON backup.">
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const n = await importFromFile(f);
              toast.success(`Restored ${n} transactions`);
            } catch {
              toast.error("Invalid backup file");
            }
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          Restore from JSON
        </Button>
      </Card>
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
