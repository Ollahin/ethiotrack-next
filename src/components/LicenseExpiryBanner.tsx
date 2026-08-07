import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { getLicenseRecord, subscribeUnlock, type LicenseRecord } from "@/lib/crypto";

type Variant = "dark" | "light";

function daysUntil(ts: number, now: number) {
  return Math.ceil((ts - now) / (24 * 60 * 60 * 1000));
}

export function LicenseExpiryBanner({
  variant = "light",
  thresholdDays = 3,
  showAction = true,
}: {
  variant?: Variant;
  thresholdDays?: number;
  showAction?: boolean;
}) {
  const [lic, setLic] = useState<LicenseRecord | null | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const rec = await getLicenseRecord();
      if (alive) setLic(rec ?? null);
    };
    refresh();
    const off = subscribeUnlock(refresh);
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(t);
    };
  }, []);

  if (!lic) return null;
  const days = daysUntil(lic.expiresAt, now);
  const expired = lic.expiresAt <= now;
  if (!expired && days > thresholdDays) return null;

  const dark = variant === "dark";
  const wrap = expired
    ? dark
      ? "border-red-400/30 bg-red-500/15 text-red-100"
      : "border-red-300 bg-red-50 text-red-900"
    : dark
      ? "border-amber-400/30 bg-amber-500/15 text-amber-100"
      : "border-amber-300 bg-amber-50 text-amber-900";

  const message = expired
    ? "Your license has expired. Enter the master PIN to renew for 30 days."
    : days <= 0
      ? "Your license expires today. Renew with the master PIN to keep access."
      : `Your license expires in ${days} day${days === 1 ? "" : "s"}. Renew with the master PIN to avoid interruption.`;

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${wrap}`} role="status">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-semibold">{expired ? "License expired" : "License expiring soon"}</div>
        <div className="text-xs opacity-90 mt-0.5">{message}</div>
      </div>
      {showAction && (
        <Link
          to="/account"
          className={`text-xs font-semibold underline underline-offset-2 whitespace-nowrap ${dark ? "text-white" : ""}`}
        >
          Renew
        </Link>
      )}
    </div>
  );
}
