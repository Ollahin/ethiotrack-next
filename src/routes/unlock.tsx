import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getLicense,
  getLockoutStatus,
  isUnlocked,
  verifyDailyPin,
  getInstallationId,
  activateLicense,
  subscribeLockout,
  type LockoutStatus,
  type AuthKind,
  type LicenseCredential,
} from "@/lib/crypto";
import { accountIsEmpty } from "@/lib/db";

import { Lock, Timer, Download, ShieldAlert, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { LicenseStatus } from "@/components/LicenseStatus";
import { LicenseExpiryBanner } from "@/components/LicenseExpiryBanner";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export const Route = createFileRoute("/unlock")({
  head: () => ({
    meta: [
      { title: "Unlock · EthioTrack" },
      { name: "description", content: "Local PIN gate. Your data never leaves this device." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UnlockPage,
});

type Mode = "loading" | "onboarding" | "unlock" | "expired" | "tamper" | "unactivated";

function UnlockPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPinInput] = useState("");
  const [credInput, setCredInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [license, setLicense] = useState<LicenseCredential | null>(null);
  const [lockout, setLockout] = useState<LockoutStatus | null>(null);
  const [installationId, setInstallationId] = useState("");

  const lockoutKind: AuthKind | null =
    mode === "unlock"
      ? "daily-pin"
      : mode === "expired" || mode === "unactivated" || mode === "tamper"
        ? "license-activation"
        : null;

  useEffect(() => {
    getInstallationId().then(setInstallationId);
  }, []);

  useEffect(() => {
    if (!lockoutKind) {
      setLockout(null);
      return;
    }
    let alive = true;
    const refresh = async () => {
      const s = await getLockoutStatus(lockoutKind);
      if (alive) setLockout(s);
    };
    refresh();
    const unsub = subscribeLockout(refresh);
    const t = setInterval(refresh, 1000);
    return () => {
      alive = false;
      unsub();
      clearInterval(t);
    };
  }, [lockoutKind]);

  async function resolveMode(): Promise<Mode> {
    const { getLicenseState, getLicense, hasDailyPin } = await import("@/lib/crypto");
    const state = await getLicenseState();
    const lic = await getLicense();

    setLicense(lic ?? null);

    if (state === "TAMPER_LOCKED") return "tamper";
    if (state === "EXPIRED") return "expired";
    if (state === "UNACTIVATED") {
      const empty = await accountIsEmpty();
      return empty ? "unactivated" : "tamper";
    }

    // VALID state - check if we need onboarding (fresh device with license but no PIN/data)
    const empty = await accountIsEmpty();
    const pinExists = await hasDailyPin();
    if (empty || !pinExists) return "onboarding";

    return "unlock";
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = await resolveMode();
      if (!alive) return;
      if (next === "unlock" && isUnlocked()) {
        nav({ to: "/", replace: true });
        return;
      }
      setMode(next);
    })();
    return () => {
      alive = false;
    };
  }, [nav]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await verifyDailyPin(pin);
      if (ok) {
        nav({ to: "/" });
      } else {
        toast.error("Incorrect Daily PIN");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Locked");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const cred: LicenseCredential = JSON.parse(credInput);
      await activateLicense(cred);
      toast.success("License activated");
      setCredInput("");
      const next = await resolveMode();
      setMode(next);
      if (next === "unlock" && isUnlocked()) {
        nav({ to: "/" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid credential format");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") return null;
  if (mode === "onboarding") return <OnboardingFlow />;

  if (mode === "expired" || mode === "tamper" || mode === "unactivated") {
    const isTamper = mode === "tamper";
    const isUnactivated = mode === "unactivated";

    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-white px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div
              className={`inline-flex items-center justify-center h-12 w-12 rounded-full ${
                isTamper
                  ? "bg-amber-500/20 text-amber-400"
                  : isUnactivated
                    ? "bg-primary/20 text-primary"
                    : "bg-red-500/20 text-red-400"
              }`}
            >
              {isTamper ? (
                <ShieldAlert className="h-6 w-6" />
              ) : isUnactivated ? (
                <KeyRound className="h-6 w-6" />
              ) : (
                <Timer className="h-6 w-6" />
              )}
            </div>
            <h1 className="mt-4 text-2xl font-bold">
              {isTamper
                ? "Tamper Protection"
                : isUnactivated
                  ? "Activation Required"
                  : "Subscription Expired"}
            </h1>
            <p className="text-sm text-white/60 mt-2">
              {isTamper
                ? "why am I having the tamper protection? why cant I log in? Account data exists but a valid Operations authorization is missing. Paste a recovery credential to continue."
                : isUnactivated
                  ? "This device is not yet authorized to run EthioTrack. Paste an activation credential from Operations to begin."
                  : "Access to this ledger has ended. Your data is preserved locally. Paste a new activation credential from Operations to continue."}

            </p>
          </div>

          <form onSubmit={handleActivate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold ml-1">
                Installation ID (Device Bound)
              </label>
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs font-mono break-all select-all">
                {installationId}
              </div>
            </div>

            <textarea
              placeholder="Paste activation credential JSON here..."
              value={credInput}
              onChange={(e) => setCredInput(e.target.value)}
              className="w-full h-32 bg-white/5 border-white/10 rounded-lg p-3 text-xs font-mono text-white placeholder:text-white/20 resize-none focus:ring-1 focus:ring-primary outline-none"
            />

            <Button
              type="submit"
              disabled={busy || !credInput || !!lockout?.locked}
              className="w-full h-12"
            >
              {lockout?.locked
                ? `Locked · ${Math.ceil(lockout.msRemaining / 1000)}s`
                : isTamper
                  ? "Restore Authorization"
                  : isUnactivated
                    ? "Activate Device"
                    : "Renew Access"}
            </Button>
          </form>

          {!isUnactivated && (
            <div className="pt-4 border-t border-white/5 space-y-3">
              <Button
                variant="outline"
                className="w-full border-white/10 hover:bg-white/5 text-white/70"
                onClick={() => nav({ to: "/exports" })}
              >
                <Download className="h-4 w-4 mr-2" /> Export Backup
              </Button>
              <p className="text-[10px] text-white/40 text-center leading-relaxed">
                Your Daily PIN cannot bypass this. Only a valid operations credential can restore
                access.
              </p>
            </div>
          )}

          {isUnactivated && (
            <p className="text-[10px] text-white/40 text-center leading-relaxed">
              EthioTrack is a local-only application. Operations activation is required for fresh
              installations.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white px-4">
      <form onSubmit={handleUnlock} className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary/20 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            Ethio<span className="text-primary">Track</span>
          </h1>
          <div className="text-xs font-semibold uppercase tracking-wider text-primary/80 mt-2">
            Enter Daily PIN
          </div>
          <p className="text-sm text-white/60 mt-1">
            License active until{" "}
            {license ? new Date(license.expiresAt).toLocaleDateString() : "..."}
          </p>
        </div>

        <Input
          type="password"
          autoFocus
          placeholder="Daily PIN"
          value={pin}
          onChange={(e) => setPinInput(e.target.value)}
          className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest h-12"
        />

        <LicenseExpiryBanner variant="dark" showAction={false} />

        <Button type="submit" disabled={busy || !!lockout?.locked} className="w-full h-12">
          {lockout?.locked ? `Locked · ${Math.ceil(lockout.msRemaining / 1000)}s` : "Unlock"}
        </Button>

        {lockout && !lockout.locked && lockout.failures > 0 && (
          <p className="text-[11px] text-amber-300/80 text-center">
            {lockout.attemptsLeft} attempt{lockout.attemptsLeft === 1 ? "" : "s"} left before
            temporary lockout.
          </p>
        )}

        <div className="pt-4 text-center">
          <LicenseStatus variant="dark" onlyNearExpiry />
        </div>
      </form>
    </div>
  );
}
