import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { clearAll, importAll, useTransactions } from "@/lib/db";
import { formatEtb, santimToEtb } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { toast } from "sonner";
import { Download, Upload, Trash2 } from "lucide-react";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export · EthioTrack" },
      {
        name: "description",
        content: "Export or restore your EthioTrack data as CSV or JSON.",
      },
    ],
  }),
  component: ExportPage,
});

function download(name: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(txns: Transaction[]): string {
  const cols = [
    "date",
    "type",
    "amount_etb",
    "party",
    "channel",
    "reference",
    "note",
    "settled",
  ];
  const esc = (v: unknown) => {
    let s = v === undefined || v === null ? "" : String(v);
    // Guard against CSV formula injection when opened in Excel/Sheets:
    // any cell starting with =, +, -, @, tab, or CR is prefixed with a
    // single apostrophe so spreadsheet apps treat it as text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = txns.map((t) =>
    [
      t.date,
      t.type,
      santimToEtb(t.amountSantim).toFixed(2),
      t.party,
      t.channel,
      t.reference ?? "",
      t.note ?? "",
      t.type === "credit" ? (t.settled ? "yes" : "no") : "",
    ]
      .map(esc)
      .join(","),
  );
  return [cols.join(","), ...rows].join("\n");
}

function ExportPage() {
  const { transactions } = useTransactions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const stamp = new Date().toISOString().slice(0, 10);

  function exportCsv() {
    download(`ethiotrack-${stamp}.csv`, "text/csv", toCsv(transactions));
    toast.success("CSV downloaded");
  }
  function exportJson() {
    download(
      `ethiotrack-${stamp}.json`,
      "application/json",
      JSON.stringify({ version: 1, transactions }, null, 2),
    );
    toast.success("JSON downloaded");
  }

  async function onImport(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rows: Transaction[] = Array.isArray(data)
        ? data
        : (data.transactions ?? []);
      if (!Array.isArray(rows)) throw new Error("Bad shape");
      const n = await importAll(rows);
      toast.success(`Restored ${n} transaction${n === 1 ? "" : "s"}`);
    } catch {
      toast.error("Invalid JSON backup");
    } finally {
      setBusy(false);
    }
  }

  const totalIn = transactions
    .filter((t) => t.type === "in")
    .reduce((a, t) => a + t.amountSantim, 0);
  const totalOut = transactions
    .filter((t) => t.type === "out")
    .reduce((a, t) => a + t.amountSantim, 0);

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-bold">Your data</h2>
        <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase text-ink-soft font-semibold">
              Transactions
            </dt>
            <dd className="font-bold tabular-nums">{transactions.length}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase text-ink-soft font-semibold">
              Total in
            </dt>
            <dd className="font-bold text-money-in tabular-nums">
              {formatEtb(totalIn, false)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase text-ink-soft font-semibold">
              Total out
            </dt>
            <dd className="font-bold text-money-out tabular-nums">
              {formatEtb(totalOut, false)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-bold">Export</h2>
        <p className="text-xs text-ink-soft">
          Save a copy of every transaction. Files stay on your device unless you
          share them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportCsv} disabled={!transactions.length}>
            <Download className="h-4 w-4 mr-1.5" /> Download CSV
          </Button>
          <Button
            onClick={exportJson}
            variant="secondary"
            disabled={!transactions.length}
          >
            <Download className="h-4 w-4 mr-1.5" /> Download JSON
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-bold">Restore backup</h2>
        <p className="text-xs text-ink-soft">
          Import a JSON backup previously exported here. Existing rows with the
          same ID are overwritten.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="h-4 w-4 mr-1.5" />
          Choose JSON file
        </Button>
      </div>

      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        <h2 className="text-sm font-bold text-destructive">Danger zone</h2>
        <p className="text-xs text-ink-soft">
          Delete every transaction stored on this device. This cannot be undone.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={!transactions.length}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear all data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all transactions?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all {transactions.length} transaction
                {transactions.length === 1 ? "" : "s"} from this browser.
                Export a backup first if you want to keep them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await clearAll();
                  toast.success("All data cleared");
                }}
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}