import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasPin, isUnlocked, setPin, verifyPin } from "@/lib/crypto";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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

function UnlockPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [pin, setPinInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (isUnlocked()) { nav({ to: "/" }); return; }
      setMode((await hasPin()) ? "unlock" : "setup");
    })();
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "setup") {
        if (pin.length < 4) return toast.error("PIN must be at least 4 characters");
        if (pin !== confirm) return toast.error("PINs don't match");
        await setPin(pin);
        toast.success("PIN set");
        nav({ to: "/" });
      } else {
        const ok = await verifyPin(pin);
        if (!ok) return toast.error("Incorrect PIN");
        nav({ to: "/" });
      }
    } finally { setBusy(false); }
  }

  if (mode === "loading") return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary/20 text-primary">
            {mode === "setup" ? <ShieldCheck className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            Ethio<span className="text-primary">Track</span>
          </h1>
          <p className="text-sm text-white/60 mt-1">
            {mode === "setup" ? "Create a local PIN to protect your ledger." : "Enter your PIN to continue."}
          </p>
        </div>
        <Input
          type="password" autoFocus inputMode="numeric"
          placeholder="PIN"
          value={pin} onChange={(e) => setPinInput(e.target.value)}
          className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest"
        />
        {mode === "setup" && (
          <Input
            type="password" inputMode="numeric"
            placeholder="Confirm PIN"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="bg-white/5 border-white/10 text-white text-center text-lg tracking-widest"
          />
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {mode === "setup" ? "Set PIN & continue" : "Unlock"}
        </Button>
        {mode === "setup" && (
          <p className="text-[11px] text-white/50 text-center leading-relaxed">
            The PIN is stored only on this device. Losing it does not destroy your data in v1, but no cloud recovery exists.
          </p>
        )}
      </form>
    </div>
  );
}