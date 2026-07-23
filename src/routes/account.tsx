import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LicenseStatus } from "@/components/LicenseStatus";
import { changeMasterPin, changePin, clearPin, renewLicense } from "@/lib/crypto";
import { clearAll } from "@/lib/db";
import { getUserName, setUserName, useUserName } from "@/lib/user";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account · EthioTrack" },
      { name: "description", content: "Your name, license, PIN and master PIN." },
      { property: "og:title", content: "Account · EthioTrack" },
      { property: "og:description", content: "Manage your profile, license and security." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const currentName = useUserName();
  const [name, setName] = useState("");
  const [oldPin, setOld] = useState("");
  const [newPin, setNew] = useState("");
  const [oldMaster, setOldMaster] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [renewPin, setRenewPin] = useState("");

  useEffect(() => {
    getUserName().then((n) => setName(n ?? ""));
  }, []);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Account</h1>
        {currentName && (
          <p className="text-sm text-ink-soft mt-1">Signed in as <span className="font-semibold text-foreground">{currentName}</span></p>
        )}
      </div>

      <LicenseStatus />

      <Card title="Your name" desc="How the app addresses you.">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          <Button
            onClick={async () => {
              try {
                await setUserName(name);
                toast.success("Name updated");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not save");
              }
            }}
          >
            Save name
          </Button>
        </div>
      </Card>

      <Card title="Change PIN" desc="Set a new daily PIN. Doesn't affect stored data.">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Current PIN</Label><Input type="password" value={oldPin} onChange={(e) => setOld(e.target.value)} /></div>
          <div><Label>New PIN</Label><Input type="password" value={newPin} onChange={(e) => setNew(e.target.value)} /></div>
        </div>
        <Button className="mt-3" onClick={async () => {
          try {
            const ok = await changePin(oldPin, newPin);
            if (ok) { toast.success("PIN updated"); setOld(""); setNew(""); }
            else toast.error("Current PIN is wrong");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Locked");
          }
        }}>Update PIN</Button>
      </Card>

      <Card title="Renew license" desc="Enter the master PIN to extend by 30 days.">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="password" placeholder="Master PIN" value={renewPin} onChange={(e) => setRenewPin(e.target.value)} />
          <Button
            onClick={async () => {
              try {
                const rec = await renewLicense(renewPin);
                if (rec) { toast.success("License renewed for 30 days"); setRenewPin(""); }
                else toast.error("Incorrect master PIN");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Locked");
              }
            }}
          >
            Renew
          </Button>
        </div>
      </Card>

      <Card title="Change master PIN" desc="Owner-only. Requires the current master PIN.">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Current master PIN</Label><Input type="password" value={oldMaster} onChange={(e) => setOldMaster(e.target.value)} /></div>
          <div><Label>New master PIN</Label><Input type="password" value={newMaster} onChange={(e) => setNewMaster(e.target.value)} /></div>
        </div>
        <Button className="mt-3" onClick={async () => {
          try {
            if (newMaster.length < 6) return toast.error("Master PIN must be at least 6 characters");
            const ok = await changeMasterPin(oldMaster, newMaster);
            if (ok) { toast.success("Master PIN updated"); setOldMaster(""); setNewMaster(""); }
            else toast.error("Current master PIN is wrong");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Locked");
          }
        }}>Update master PIN</Button>
      </Card>

      <Card title="Danger zone" desc="Both actions are irreversible.">
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={async () => {
            if (!confirm("Delete ALL transactions and master data? This cannot be undone.")) return;
            await clearAll();
            toast.success("All data cleared");
          }}>Clear all data</Button>
          <Button variant="outline" onClick={async () => {
            if (!confirm("Remove the daily PIN? App will ask to set a new one.")) return;
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