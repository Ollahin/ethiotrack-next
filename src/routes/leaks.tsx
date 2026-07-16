import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getIgnoredLeaks, setIgnoredLeaks, useTransactions } from "@/lib/db";
import { detectLeaks } from "@/lib/leaks";
import { formatEtb, formatDateTime } from "@/lib/format";
import { ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";

export const Route = createFileRoute("/leaks")({
  head: () => ({
    meta: [
      { title: "Leaks · EthioTrack" },
      {
        name: "description",
        content:
          "Automatic anomaly detection: duplicates, large outflows, airtime spikes and aging credits.",
      },
    ],
  }),
  component: LeaksPage,
});

function LeaksPage() {
  const { transactions } = useTransactions();
  const findings = useMemo(() => detectLeaks(transactions), [transactions]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    void getIgnoredLeaks().then(setIgnored);
  }, []);

  async function ignore(id: string) {
    const s = new Set(ignored);
    s.add(id);
    setIgnored(s);
    await setIgnoredLeaks(s);
  }
  async function unignore(id: string) {
    const s = new Set(ignored);
    s.delete(id);
    setIgnored(s);
    await setIgnoredLeaks(s);
  }

  const active = findings.filter((f) => !ignored.has(f.id));
  const dismissed = findings.filter((f) => ignored.has(f.id));
  const txnById = new Map(transactions.map((t) => [t.id, t]));

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 flex items-center gap-3">
        {active.length === 0 ? (
          <>
            <ShieldCheck className="h-8 w-8 text-money-in" />
            <div>
              <div className="font-bold">No leaks detected</div>
              <div className="text-xs text-ink-soft">
                Your transactions look consistent.
              </div>
            </div>
          </>
        ) : (
          <>
            <ShieldAlert className="h-8 w-8 text-money-out" />
            <div>
              <div className="font-bold">
                {active.length} finding{active.length === 1 ? "" : "s"} to review
              </div>
              <div className="text-xs text-ink-soft">
                Auto-scanned across your local history.
              </div>
            </div>
          </>
        )}
      </div>

      <ul className="space-y-2">
        {active.map((f) => (
          <li
            key={f.id}
            className="rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span
                  className={
                    "inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-white mt-0.5 " +
                    (f.severity === "high"
                      ? "bg-money-out"
                      : f.severity === "medium"
                        ? "bg-airtime"
                        : "bg-ink-soft")
                  }
                >
                  {f.severity}
                </span>
                <div>
                  <div className="font-semibold text-sm">{f.title}</div>
                  <div className="text-xs text-ink-soft">{f.reason}</div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => ignore(f.id)}
              >
                Ignore
              </Button>
            </div>
            <ul className="mt-2 space-y-1">
              {f.txnIds.map((id) => {
                const t = txnById.get(id);
                if (!t) return null;
                return (
                  <li
                    key={id}
                    className="flex justify-between text-xs bg-muted/40 rounded px-2 py-1"
                  >
                    <span className="truncate">
                      {t.party} · {t.channel} · {formatDateTime(t.date)}
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatEtb(t.amountSantim)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {dismissed.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowIgnored((v) => !v)}
          >
            {showIgnored ? "Hide" : "Show"} {dismissed.length} ignored
          </Button>
          {showIgnored && (
            <ul className="mt-2 space-y-1">
              {dismissed.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1"
                >
                  <span>{f.title}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unignore(f.id)}
                  >
                    <Undo2 className="h-3 w-3 mr-1" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}