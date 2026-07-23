import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LicenseStatus } from "@/components/LicenseStatus";
import { LicenseExpiryBanner } from "@/components/LicenseExpiryBanner";
import { changeMasterPin, changePin, clearPin, renewLicense } from "@/lib/crypto";
import { clearAll } from "@/lib/db";
import { getUserProfile, setUserProfile, useUserName, type UserProfile } from "@/lib/user";
import {
  disableBiometric,
  enrollBiometric,
  isBiometricEnabled,
  isBiometricSupported,
  isPlatformAuthenticatorAvailable,
} from "@/lib/biometric";
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
  const [profile, setProfile] = useState<UserProfile>({ name: "", phone: "", email: "", businessName: "", role: "" });
  const [oldPin, setOld] = useState("");
  const [newPin, setNew] = useState("");
  const [oldMaster, setOldMaster] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [renewPin, setRenewPin] = useState("");
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    getUserProfile().then((p) => {
      if (p) setProfile({
        name: p.name ?? "",
        phone: p.phone ?? "",
        email: p.email ?? "",
        businessName: p.businessName ?? "",
        role: p.role ?? "",
      });
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [enabled, platform] = await Promise.all([
        isBiometricEnabled(),
        isPlatformAuthenticatorAvailable(),
      ]);
      if (!alive) return;
      setBioEnabled(enabled);
      setBioSupported(isBiometricSupported() && platform);
    })();
    return () => { alive = false; };
  }, []);

  function update<K extends keyof UserProfile>(key: K, value: string) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Account</h1>
        {currentName && (
          <p className="text-sm text-ink-soft mt-1">Signed in as <span className="font-semibold text-foreground">{currentName}</span></p>
        )}
      </div>

      <LicenseExpiryBanner showAction={false} />
      <LicenseStatus />

      <Card title="Your profile" desc="How the app addresses you and who owns this ledger.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Full name</Label>
            <Input value={profile.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Meraol Tesfaye" maxLength={60} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={profile.phone ?? ""} onChange={(e) => update("phone", e.target.value)} placeholder="+251 9…" maxLength={32} inputMode="tel" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={profile.email ?? ""} onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" maxLength={120} />
          </div>
          <div>
            <Label>Business name</Label>
            <Input value={profile.businessName ?? ""} onChange={(e) => update("businessName", e.target.value)} placeholder="Shop or company" maxLength={80} />
          </div>
          <div>
            <Label>Role</Label>
            <Input value={profile.role ?? ""} onChange={(e) => update("role", e.target.value)} placeholder="Subdistributor, Agent…" maxLength={60} />
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
        <></>
      </Card>

      <Card title="Biometric unlock" desc="Use Face ID, Touch ID, or fingerprint instead of typing your daily PIN. PIN still works as fallback.">
        {!bioSupported ? (
          <p className="text-xs text-ink-soft">This device or browser doesn't support biometric unlock.</p>
        ) : bioEnabled ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">Enabled</span>
            <Button
              variant="outline"
              disabled={bioBusy}
              onClick={async () => {
                setBioBusy(true);
                try {
                  await disableBiometric();
                  setBioEnabled(false);
                  toast.success("Biometric unlock disabled");
                } finally { setBioBusy(false); }
              }}
            >
              Disable biometrics
            </Button>
          </div>
        ) : (
          <Button
            disabled={bioBusy}
            onClick={async () => {
              setBioBusy(true);
              try {
                await enrollBiometric(profile.name || currentName || "EthioTrack");
                setBioEnabled(true);
                toast.success("Biometric unlock enabled");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Enrollment failed");
              } finally { setBioBusy(false); }
            }}
          >
            {bioBusy ? "Waiting for biometrics…" : "Enable biometric unlock"}
          </Button>
        )}
      </Card>

      <Card title="Change master PIN (owner)" desc="Owner-only. Requires the current master PIN.">
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