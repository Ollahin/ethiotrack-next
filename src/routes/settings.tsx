import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadCsv, downloadJsonBackup, importFromFile } from "@/lib/backup";
import { changePin, clearPin } from "@/lib/crypto";
import { clearAll } from "@/lib/db";
import { toast } from "sonner";
import { LicenseStatus } from "@/components/LicenseStatus";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · EthioTrack" },
      { name: "description", content: "Backup, restore, PIN and data controls." },
      { property: "og:title", content: "Settings · EthioTrack" },
      { property: "og:description", content: "Local backup, PIN, and data controls." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [oldPin, setOld] = useState("");
  const [newPin, setNew] = useState("");
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">Settings</h1>

      <LicenseStatus />

      <Card title="Backup & restore" desc="Everything stays on this device. Export regularly.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadJsonBackup}>Download JSON backup</Button>
          <Button variant="secondary" onClick={downloadCsv}>Download CSV</Button>
          <input
            ref={fileRef}
            type="file" accept="application/json" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try {
                const n = await importFromFile(f);
                toast.success(`Restored ${n} transactions`);
              } catch { toast.error("Invalid backup file"); }
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>Restore from JSON</Button>
        </div>
      </Card>

      <Card title="Change PIN" desc="Set a new local PIN. Doesn't affect existing data.">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Current PIN</Label><Input type="password" value={oldPin} onChange={(e) => setOld(e.target.value)} /></div>
          <div><Label>New PIN</Label><Input type="password" value={newPin} onChange={(e) => setNew(e.target.value)} /></div>
        </div>
        <Button className="mt-3" onClick={async () => {
          const ok = await changePin(oldPin, newPin);
          if (ok) { toast.success("PIN updated"); setOld(""); setNew(""); }
          else toast.error("Current PIN is wrong");
        }}>Update PIN</Button>
      </Card>

      <Card title="Danger zone" desc="Both actions are irreversible.">
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={async () => {
            if (!confirm("Delete ALL transactions and master data? This cannot be undone.")) return;
            await clearAll();
            toast.success("All data cleared");
          }}>Clear all data</Button>
          <Button variant="outline" onClick={async () => {
            if (!confirm("Remove the PIN? App will ask to set a new one.")) return;
            await clearPin();
            location.href = "/unlock";
          }}>Remove PIN</Button>
        </div>
      </Card>
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-ink-soft mb-3">{desc}</div>
      {children}
    </div>
  );
}