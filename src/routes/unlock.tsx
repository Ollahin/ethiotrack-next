import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getLockoutStatus,
  isUnlocked,
  verifyDailyPin,
  hasMasterPin,
  verifyMasterPin,
  subscribeLockout,
  type LockoutStatus,
  type AuthKind,
} from "@/lib/crypto";
import { accountIsEmpty } from "@/lib/db";

import { Lock, Timer, Download, ShieldAlert, KeyRound } from "lucide-react";
import { toast } from "sonner";
{
  /* Components removed */
}
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

type Mode = "loading" | "onboarding" | "unlock" | "master-pin-setup" | "master-pin-verify";

function UnlockPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPinInput] = useState("");
  const [masterPinInput, setMasterPinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockout, setLockout] = useState<LockoutStatus | null>(null);

  const lockoutKind: AuthKind | null =
    mode === "unlock"
      ? "daily-pin"
      : mode === "master-pin-verify" || mode === "master-pin-setup"
        ? "master-pin"
        : null;

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
    const { hasMasterPin, hasDailyPin } = await import("@/lib/crypto");
    const masterExists = await hasMasterPin();

    if (!masterExists) return "master-pin-setup";

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

  async function handleMasterPin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { setupMasterPin, verifyMasterPin } = await import("@/lib/crypto");
      if (mode === "master-pin-setup") {
        await setupMasterPin(masterPinInput);
        toast.success("Master PIN configured");
      } else {
        const ok = await verifyMasterPin(masterPinInput);
        if (!ok) {
          toast.error("Incorrect Master PIN");
          return;
        }
      }
      setMasterPinInput("");
      const next = await resolveMode();
      setMode(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") return null;
  if (mode === "onboarding") return <OnboardingFlow />;

  if (mode === "master-pin-setup" || mode === "master-pin-verify") {
    const isSetup = mode === "master-pin-setup";
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-white px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-500/20 text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">
              {isSetup ? "Configure Master PIN" : "Product Access Required"}
            </h1>
            <p className="text-sm text-white/60 mt-2">
              {isSetup
                ? "Setup the operations-managed master PIN to begin."
                : "Enter the master PIN provided by your distributor to continue using EthioTrack."}
            </p>
          </div>

          <form onSubmit={handleMasterPin} className="space-y-4">
            <Input
              type="password"
              autoFocus
              placeholder="Master PIN"
              value={masterPinInput}
              onChange={(e) => setMasterPinInput(e.target.value)}
              className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest h-12"
            />
            <Button
              type="submit"
              disabled={busy || masterPinInput.length < 6 || !!lockout?.locked}
              className="w-full h-12"
            >
              {lockout?.locked
                ? `Locked · ${Math.ceil(lockout.msRemaining / 1000)}s`
                : isSetup
                  ? "Initialize Application"
                  : "Verify Access"}
            </Button>
          </form>

          <div className="pt-4 border-t border-white/5">
            <p className="text-[10px] text-white/40 text-center leading-relaxed uppercase tracking-wider">
              Operations authorization · Local only
            </p>
          </div>
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
            {
              "'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''\n                                            \n                                            what's the pin?"
            }
          </div>
          <p className="text-sm text-white/60 mt-1">Product access active</p>
        </div>

        <Input
          type="password"
          autoFocus
          placeholder="Daily PIN"
          value={pin}
          onChange={(e) => setPinInput(e.target.value)}
          className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest h-12"
        />

        {/* Banner removed */}

        <Button type="submit" disabled={busy || !!lockout?.locked} className="w-full h-12">
          {lockout?.locked ? `Locked · ${Math.ceil(lockout.msRemaining / 1000)}s` : "Unlock"}
        </Button>

        {lockout && !lockout.locked && lockout.failures > 0 && (
          <p className="text-[11px] text-amber-300/80 text-center">
            {lockout.attemptsLeft} attempt{lockout.attemptsLeft === 1 ? "" : "s"} left before
            temporary lockout.
          </p>
        )}

        {/* Status removed */}
      </form>
    </div>
  );
}
