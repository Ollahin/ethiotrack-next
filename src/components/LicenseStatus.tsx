import { useEffect, useState } from "react";
import { getLicense, subscribeUnlock, type LicenseRecord, LICENSE_PERIOD_MS } from "@/lib/crypto";
import { ShieldCheck, ShieldAlert, Timer } from "lucide-react";

type Variant = "dark" | "card";

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(ms: number) {
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function LicenseStatus({
  variant = "card",
  onlyNearExpiry = false,
  nearExpiryDays = 3,
}: {
  variant?: Variant;
  onlyNearExpiry?: boolean;
  nearExpiryDays?: number;
}) {
  const [lic, setLic] = useState<LicenseRecord | null | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    const rec = await getLicenseRecord();
    setLic(rec ?? null);
  }

  useEffect(() => {
    refresh();
    const off = subscribeUnlock(() => {
      refresh();
    });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  if (lic === undefined) return null;

  const dark = variant === "dark";

  if (onlyNearExpiry) {
    if (!lic) return null;
    const remaining = lic.expiresAt - now;
    const withinWindow = remaining <= nearExpiryDays * 24 * 60 * 60 * 1000;
    if (!withinWindow) return null;
  }

  const wrap = dark
    ? "rounded-xl border border-white/10 bg-white/5 p-4 text-white"
    : "rounded-xl border border-border bg-card p-4 shadow-sm";
  const subText = dark ? "text-white/60" : "text-ink-soft";

  if (!lic) {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          License not activated
        </div>
        <div className={`text-xs mt-1 ${subText}`}>
          Set the master PIN to activate 30 days of access.
        </div>
      </div>
    );
  }

  const remainingMs = lic.expiresAt - now;
  const active = remainingMs > 0;
  const days = daysBetween(Math.abs(remainingMs));
  const pct = active ? Math.max(0, Math.min(100, (remainingMs / LICENSE_PERIOD_MS) * 100)) : 0;

  const tone = !active
    ? {
        icon: <ShieldAlert className="h-4 w-4 text-red-500" />,
        label: "Expired",
        chip: "bg-red-500/15 text-red-400",
        bar: "bg-red-500",
      }
    : days <= 5
      ? {
          icon: <Timer className="h-4 w-4 text-amber-500" />,
          label: "Expiring soon",
          chip: "bg-amber-500/15 text-amber-400",
          bar: "bg-amber-500",
        }
      : {
          icon: <ShieldCheck className="h-4 w-4 text-emerald-500" />,
          label: "Active",
          chip: "bg-emerald-500/15 text-emerald-400",
          bar: "bg-emerald-500",
        };

  return (
    <div className={wrap}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          {tone.icon}
          <span>License status</span>
        </div>
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${tone.chip}`}
        >
          {tone.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className={`text-[11px] uppercase tracking-wider ${subText}`}>
            {active ? "Days remaining" : "Expired for"}
          </div>
          <div className="text-xl font-bold tabular-nums">
            {days}
            <span className={`ml-1 text-xs font-medium ${subText}`}>
              day{days === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[11px] uppercase tracking-wider ${subText}`}>
            {active ? "Expires" : "Expired on"}
          </div>
          <div className="text-sm font-semibold">{fmtDate(lic.expiresAt)}</div>
        </div>
      </div>

      <div
        className={`mt-3 h-1.5 w-full rounded-full overflow-hidden ${dark ? "bg-white/10" : "bg-muted"}`}
      >
        <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>

      <div className={`mt-3 flex items-center justify-between text-[11px] ${subText}`}>
        <span>Activated {fmtDate(lic.activatedAt)}</span>
        <span>
          {lic.renewals} renewal{lic.renewals === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
