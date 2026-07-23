import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getLicense,
  getLockoutStatus,
  hasMasterPin,
  hasPin,
  isLicenseActive,
  isUnlocked,
  markUnlocked,
  renewLicense,
  setPin,
  setupMasterPin,
  subscribeLockout,
  type LockoutStatus,
  verifyPin,
} from "@/lib/crypto";
import { Fingerprint, KeyRound, Lock, ShieldCheck, Timer } from "lucide-react";
import { toast } from "sonner";
import { LicenseStatus } from "@/components/LicenseStatus";
import { LicenseExpiryBanner } from "@/components/LicenseExpiryBanner";
import { setUserName } from "@/lib/user";
import { assertBiometric, isBiometricEnabled } from "@/lib/biometric";

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

type Mode = "loading" | "setup-master" | "setup-user" | "unlock" | "renew";

function UnlockPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPinInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [lockout, setLockout] = useState<LockoutStatus | null>(null);
  const [bioReady, setBioReady] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    isBiometricEnabled().then((v) => { if (alive) setBioReady(v); });
    return () => { alive = false; };
  }, [mode]);

  async function tryBiometric() {
    setBioBusy(true);
    try {
      const ok = await assertBiometric();
      if (ok) {
        markUnlocked();
        nav({ to: "/" });
      } else {
        toast.error("Biometric unlock failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Biometric unlock failed");
    } finally { setBioBusy(false); }
  }

  const lockoutKind = mode === "unlock" ? "user" : (mode === "renew" ? "master" : null);

  useEffect(() => {
    if (!lockoutKind) { setLockout(null); return; }
    let alive = true;
    const refresh = async () => {
      const s = await getLockoutStatus(lockoutKind);
      if (alive) setLockout(s);
    };
    refresh();
    const unsub = subscribeLockout(refresh);
    const t = setInterval(refresh, 1000);
    return () => { alive = false; unsub(); clearInterval(t); };
  }, [lockoutKind]);

  async function resolveMode(): Promise<Mode> {
    const [master, user, licensed, lic] = await Promise.all([
      hasMasterPin(),
      hasPin(),
      isLicenseActive(),
      getLicense(),
    ]);
    setExpiresAt(lic?.expiresAt ?? null);
    if (!master) return "setup-master";
    if (!licensed) return "renew";
    if (!user) return "setup-user";
    return "unlock";
  }

  useEffect(() => {
    (async () => {
      const next = await resolveMode();
      if (next === "unlock" && isUnlocked()) { nav({ to: "/" }); return; }
      setMode(next);
    })();
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "setup-master") {
        if (pin.length < 6) return toast.error("Master PIN must be at least 6 characters");
        if (pin !== confirm) return toast.error("Master PINs don't match");
        await setupMasterPin(pin);
        toast.success("Master PIN set — license active for 30 days");
        setPinInput(""); setConfirm("");
        setMode(await resolveMode());
      } else if (mode === "renew") {
        try {
          const rec = await renewLicense(pin);
          if (!rec) return toast.error("Incorrect master PIN");
          toast.success("License renewed for 30 days");
          setPinInput("");
          setMode(await resolveMode());
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Locked");
        }
      } else if (mode === "setup-user") {
        if (name.trim().length < 2) return toast.error("Enter your name");
        if (pin.length < 4) return toast.error("PIN must be at least 4 characters");
        if (pin !== confirm) return toast.error("PINs don't match");
        await setUserName(name);
        await setPin(pin);
        toast.success(`Welcome, ${name.trim().split(/\s+/)[0]}`);
        nav({ to: "/" });
      } else {
        try {
          const ok = await verifyPin(pin);
          if (!ok) return toast.error("Incorrect PIN");
          nav({ to: "/" });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Locked");
        }
      }
    } finally { setBusy(false); }
  }

  if (mode === "loading") return null;

  const copy = {
    "setup-master": {
      icon: <KeyRound className="h-6 w-6" />,
      title: "Owner setup",
      sub: "Create the master PIN. You'll re-enter it every month to keep the app active.",
      cta: "Set master PIN & activate",
      confirm: true,
      note: "The master PIN is stored only on this device. Keep it private — anyone with it can extend the license.",
    },
    "renew": {
      icon: <Timer className="h-6 w-6" />,
      title: "License expired",
      sub: expiresAt
        ? `Access ended ${new Date(expiresAt).toLocaleDateString()}. Enter the master PIN to extend by 30 days.`
        : "Enter the master PIN to activate 30 days of access.",
      cta: "Renew for 30 days",
      confirm: false,
      note: "Only the prototype owner has this PIN. The daily user PIN cannot renew the license.",
    },
    "setup-user": {
      icon: <ShieldCheck className="h-6 w-6" />,
      title: "Create daily PIN",
      sub: "This is the PIN the operator types every day to open the ledger.",
      cta: "Set PIN & continue",
      confirm: true,
      note: "Separate from the master PIN. Losing it does not destroy data in v1.",
    },
    "unlock": {
      icon: <Lock className="h-6 w-6" />,
      title: "Enter your PIN",
      sub: expiresAt
        ? `License active until ${new Date(expiresAt).toLocaleDateString()}.`
        : "Enter your PIN to continue.",
      cta: "Unlock",
      confirm: false,
      note: null as string | null,
    },
  }[mode];

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary/20 text-primary">
            {copy.icon}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            Ethio<span className="text-primary">Track</span>
          </h1>
          <div className="text-xs font-semibold uppercase tracking-wider text-primary/80 mt-2">
            {copy.title}
          </div>
          <p className="text-sm text-white/60 mt-1">{copy.sub}</p>
        </div>
        <Input
          type="password" autoFocus
          placeholder={mode === "setup-master" || mode === "renew" ? "Master PIN" : "PIN"}
          value={pin} onChange={(e) => setPinInput(e.target.value)}
          className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest"
        />
        {mode !== "setup-master" && mode !== "renew" && (
          <LicenseExpiryBanner variant="dark" showAction={false} />
        )}
        {copy.confirm && (
          <Input
            type="password"
            placeholder="Confirm PIN"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest"
          />
        )}
        {mode === "setup-user" && (
          <Input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="bg-white/5 border-white/10 text-white text-center"
          />
        )}
        <Button type="submit" disabled={busy || !!lockout?.locked} className="w-full">
          {lockout?.locked
            ? `Locked · ${Math.ceil(lockout.msRemaining / 1000)}s`
            : copy.cta}
        </Button>
        {lockout && !lockout.locked && lockout.failures > 0 && (
          <p className="text-[11px] text-amber-300/80 text-center">
            {lockout.attemptsLeft} attempt{lockout.attemptsLeft === 1 ? "" : "s"} left before temporary lockout.
          </p>
        )}
        {lockout?.locked && (
          <p className="text-[11px] text-red-300/80 text-center">
            Too many wrong PINs. Try again in {Math.ceil(lockout.msRemaining / 1000)}s.
          </p>
        )}
        {copy.note && (
          <p className="text-[11px] text-white/50 text-center leading-relaxed">{copy.note}</p>
        )}
        {mode !== "setup-master" && mode !== "renew" && (
          <LicenseStatus variant="dark" onlyNearExpiry />
        )}
        {mode === "renew" && <LicenseStatus variant="dark" />}
      </form>
    </div>
  );
}