import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeDailyPin, clearDailyPin, verifyDailyPin } from "@/lib/crypto";
import { clearAll } from "@/lib/db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getUserProfile, setUserProfile, useUserName, type UserProfile } from "@/lib/user";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account · EthioTrack" },
      { name: "description", content: "Your name, license, and PIN." },
      { property: "og:title", content: "Account · EthioTrack" },
      { property: "og:description", content: "Manage your profile and security." },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const currentName = useUserName();
  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    phone: "",
    email: "",
    businessName: "",
    role: "",
  });
  const [oldPin, setOld] = useState("");
  const [newPin, setNew] = useState("");
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipePin, setWipePin] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);

  useEffect(() => {
    getUserProfile().then((p) => {
      if (p)
        setProfile({
          name: p.name ?? "",
          phone: p.phone ?? "",
          email: p.email ?? "",
          businessName: p.businessName ?? "",
          role: p.role ?? "",
        });
    });
  }, []);

  function update<K extends keyof UserProfile>(key: K, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Account</h1>
        {currentName && (
          <p className="text-sm text-ink-soft mt-1">
            Signed in as <span className="font-semibold text-foreground">{currentName}</span>
          </p>
        )}
      </div>

      {/* License components removed */}

      <Card title="Your profile" desc="How the app addresses you and who owns this ledger.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Full name</Label>
            <Input
              value={profile.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. Meraol Tesfaye"
              maxLength={60}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={profile.phone ?? ""}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+251 9…"
              maxLength={32}
              inputMode="tel"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={profile.email ?? ""}
              onChange={(e) => update("email", e.target.value)}
              placeholder="you@example.com"
              maxLength={120}
            />
          </div>
          <div>
            <Label>Business name</Label>
            <Input
              value={profile.businessName ?? ""}
              onChange={(e) => update("businessName", e.target.value)}
              placeholder="Shop or company"
              maxLength={80}
            />
          </div>
          <div>
            <Label>Role</Label>
            <Input
              value={profile.role ?? ""}
              onChange={(e) => update("role", e.target.value)}
              placeholder="Subdistributor, Agent…"
              maxLength={60}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          onClick={async () => {
            try {
              const saved = await setUserProfile(profile);
              setProfile({
                name: saved.name,
                phone: saved.phone ?? "",
                email: saved.email ?? "",
                businessName: saved.businessName ?? "",
                role: saved.role ?? "",
              });
              toast.success("Profile updated");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not save");
            }
          }}
        >
          Save profile
        </Button>
      </Card>

      <Card title="Change Daily PIN" desc="Set a new daily PIN. Doesn't affect stored data.">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Current PIN</Label>
            <Input type="password" value={oldPin} onChange={(e) => setOld(e.target.value)} />
          </div>
          <div>
            <Label>New PIN</Label>
            <Input type="password" value={newPin} onChange={(e) => setNew(e.target.value)} />
          </div>
        </div>
        <Button
          className="mt-3"
          onClick={async () => {
            try {
              const ok = await changeDailyPin(oldPin, newPin);
              if (ok) {
                toast.success("PIN updated");
                setOld("");
                setNew("");
              } else toast.error("Current PIN is wrong");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Locked");
            }
          }}
        >
          Update PIN
        </Button>
      </Card>

      <Card
        title="Product access"
        desc="Your subscription is managed by operations via Master PIN."
      >
        <p className="text-sm text-ink-soft">
          Renewals require entering the Master PIN provided by your distributor.
        </p>
        <Button variant="outline" className="mt-3" onClick={() => (location.href = "/unlock")}>
          Security status
        </Button>
      </Card>

      <Card title="Danger zone" desc="Irreversible actions. Be careful.">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            onClick={() => {
              setWipePin("");
              setWipeOpen(true);
            }}
          >
            Clear all data
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!confirm("Remove the daily PIN? App will ask to set a new one.")) return;
              await clearDailyPin();
              location.href = "/unlock";
            }}
          >
            Remove PIN
          </Button>
        </div>
      </Card>

      <Dialog
        open={wipeOpen}
        onOpenChange={(v) => {
          if (!wipeBusy) setWipeOpen(v);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm with your PIN</DialogTitle>
            <DialogDescription>
              This deletes ALL transactions, agents, banks, distributors and settings on this
              device. Enter your daily PIN to continue — this cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            placeholder="Daily PIN"
            value={wipePin}
            onChange={(e) => setWipePin(e.target.value)}
            className="text-center text-lg tracking-widest"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setWipeOpen(false)} disabled={wipeBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={wipeBusy || wipePin.length < 4}
              onClick={async () => {
                setWipeBusy(true);
                try {
                  const ok = await verifyDailyPin(wipePin);
                  if (!ok) {
                    toast.error("Incorrect PIN");
                    return;
                  }
                  await clearAll();
                  toast.success("All data cleared");
                  setWipeOpen(false);
                  setWipePin("");
                  location.href = "/unlock";
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Locked");
                } finally {
                  setWipeBusy(false);
                }
              }}
            >
              {wipeBusy ? "Verifying…" : "Delete everything"}
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
