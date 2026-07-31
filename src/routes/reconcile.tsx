import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { Landmark, Radio, Wallet, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useBanks,
  useDistributors,
  useTransactions,
  usePeriodOpening,
  getWeekStart,
  getWeekEnd,
} from "@/lib/db";
import { formatEtb, parseEtbToSantim } from "@/lib/format";
import {
  distributorLedger,
  expectedStock,
  shiftWeekStart,
  weekRangeOf,
  type AirtimeMovement,
} from "@/lib/distributor-ledger";
import { Input } from "@/components/ui/input";
import type { Bank, Distributor, Transaction } from "@/lib/types";

export const Route = createFileRoute("/reconcile")({
  head: () => ({
    meta: [
      { title: "Reconcile week · EthioTrack" },
      {
        name: "description",
        content:
          "Compare opening balances, entered transactions and closing balances per bank and distributor.",
      },
      { property: "og:title", content: "Weekly reconciliation · EthioTrack" },
      {
        property: "og:description",
        content: "Spot cash and airtime variances before closing the week.",
      },
    ],
  }),
  component: ReconcilePage,
});

// -- helpers ---------------------------------------------------------------

function inWeek(t: Transaction, start: string, end: string): boolean {
  const d = t.date.slice(0, 10);
  return d >= start && d <= end && !t.isPersonal;
}

type BankRow = {
  bank: Bank;
  opening: number;
  inSum: number;
  outSum: number;
  expected: number;
  actualInput: string;
  actual: number | null;
  variance: number | null;
  count: number;
};

type DistRow = {
  dist: Distributor;
  evdOpen: number;
  fltOpen: number;
  evd: AirtimeMovement;
  float: AirtimeMovement;
  evdExpected: number;
  fltExpected: number;
  evdActualInput: string;
  fltActualInput: string;
  evdActual: number | null;
  fltActual: number | null;
  evdVariance: number | null;
  fltVariance: number | null;
  count: number;
};

function parseOptional(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const santim = parseEtbToSantim(trimmed);
  return santim === null ? null : santim;
}

function varianceClass(v: number | null): string {
  if (v === null) return "text-ink-soft";
  if (v === 0) return "text-money-in";
  return "text-money-out";
}

// -- page ------------------------------------------------------------------

function ReconcilePage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const weekEnd = getWeekEnd(weekStart);
  const thisWeekStart = getWeekStart();
  const opening = usePeriodOpening(weekStart);
  const banks = useBanks();
  const distributors = useDistributors();
  const txns = useTransactions();
  const [cashActual, setCashActual] = useState("");
  const [bankActuals, setBankActuals] = useState<Record<string, string>>({});
  const [evdActuals, setEvdActuals] = useState<Record<string, string>>({});
  const [fltActuals, setFltActuals] = useState<Record<string, string>>({});

  const weekTxns = useMemo(
    () => txns.filter((t) => inWeek(t, weekStart, weekEnd)),
    [txns, weekStart, weekEnd],
  );

  // Cash reconciliation (untied to any bank / distributor).
  const cashOpening = opening?.cashOnHandSantim ?? 0;
  const cash = useMemo(() => {
    let inSum = 0,
      outSum = 0;
    for (const t of weekTxns) {
      if (
        t.bankId ||
        t.channel === "cash" ||
        (!t.bankId &&
          !t.distributorId &&
          (t.type === "in" || t.type === "out" || t.type === "expense"))
      ) {
        if (t.channel !== "cash") continue;
        if (t.type === "in") inSum += t.amountSantim;
        else if (t.type === "out" || t.type === "expense") outSum += t.amountSantim;
      }
    }
    const expected = cashOpening + inSum - outSum;
    const actual = parseOptional(cashActual);
    return {
      opening: cashOpening,
      inSum,
      outSum,
      expected,
      actual,
      variance: actual === null ? null : actual - expected,
    };
  }, [weekTxns, cashOpening, cashActual]);

  const bankRows: BankRow[] = useMemo(() => {
    return banks.map((bank) => {
      let inSum = 0,
        outSum = 0,
        count = 0;
      for (const t of weekTxns) {
        if (t.bankId !== bank.id) continue;
        count++;
        if (t.type === "in") inSum += t.amountSantim;
        else if (t.type === "out" || t.type === "expense") outSum += t.amountSantim;
      }
      const openingAmt = opening?.bankBalances?.[bank.id] ?? 0;
      const expected = openingAmt + inSum - outSum;
      const actualInput = bankActuals[bank.id] ?? "";
      const actual = parseOptional(actualInput);
      return {
        bank,
        opening: openingAmt,
        inSum,
        outSum,
        expected,
        actualInput,
        actual,
        variance: actual === null ? null : actual - expected,
        count,
      };
    });
  }, [banks, weekTxns, opening, bankActuals]);

  const distRows: DistRow[] = useMemo(() => {
    return distributors.map((dist) => {
      const ledger = distributorLedger(weekTxns, dist.id, weekRangeOf(weekStart));
      const count = ledger.count;
      const evdOpen = opening?.evdStockByDistributor?.[dist.id] ?? 0;
      const fltOpen = opening?.floatStockByDistributor?.[dist.id] ?? 0;
      const evdExpected = expectedStock(evdOpen, ledger.evd);
      const fltExpected = expectedStock(fltOpen, ledger.float);
      const evdActualInput = evdActuals[dist.id] ?? "";
      const fltActualInput = fltActuals[dist.id] ?? "";
      const evdActual = parseOptional(evdActualInput);
      const fltActual = parseOptional(fltActualInput);
      return {
        dist,
        evdOpen,
        fltOpen,
        evd: ledger.evd,
        float: ledger.float,
        evdExpected,
        fltExpected,
        evdActualInput,
        fltActualInput,
        evdActual,
        fltActual,
        evdVariance: evdActual === null ? null : evdActual - evdExpected,
        fltVariance: fltActual === null ? null : fltActual - fltExpected,
        count,
      };
    });
  }, [distributors, weekTxns, weekStart, opening, evdActuals, fltActuals]);

  const grand = useMemo(() => {
    const openingTotal = cash.opening + bankRows.reduce((s, r) => s + r.opening, 0);
    const inTotal = cash.inSum + bankRows.reduce((s, r) => s + r.inSum, 0);
    const outTotal = cash.outSum + bankRows.reduce((s, r) => s + r.outSum, 0);
    const expectedTotal = openingTotal + inTotal - outTotal;
    const actualTotal =
      (cash.actual ?? cash.expected) + bankRows.reduce((s, r) => s + (r.actual ?? r.expected), 0);
    return {
      openingTotal,
      inTotal,
      outTotal,
      expectedTotal,
      actualTotal,
      variance: actualTotal - expectedTotal,
    };
  }, [cash, bankRows]);

  if (opening === undefined) {
    return <div className="max-w-5xl mx-auto p-6 text-sm text-ink-soft">Loading…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Weekly reconciliation</h1>
          <p className="text-sm text-ink-soft">
            Week of {weekStart} → {weekEnd}. Enter what you actually count on hand to spot
            variances.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekStart((w) => shiftWeekStart(w, -1))}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous week
            </button>
            <button
              type="button"
              onClick={() => setWeekStart((w) => shiftWeekStart(w, 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Next week <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(thisWeekStart)}
              disabled={weekStart === thisWeekStart}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
            >
              This week
            </button>
            <span className="text-xs text-ink-soft tabular-nums">
              Mon {weekStart} – Sun {weekEnd}
            </span>
          </div>
        </div>
        <Link
          to="/close"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          Go to close week <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </header>

      {!opening && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-soft">
          This week ({weekStart} → {weekEnd}) has no opening balance yet — airtime is shown against
          a zero opening.{" "}
          <Link to="/" className="text-primary font-semibold underline">
            Open the week
          </Link>{" "}
          from the dashboard first.
        </div>
      )}

      {/* Money table */}
      <section className="rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Landmark className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Cash & bank accounts</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-ink-soft">
              <tr className="border-b border-border/60">
                <th className="text-left px-4 py-2">Account</th>
                <th className="text-right px-2 py-2">Opening</th>
                <th className="text-right px-2 py-2">In</th>
                <th className="text-right px-2 py-2">Out</th>
                <th className="text-right px-2 py-2">Expected</th>
                <th className="text-right px-2 py-2">Actual (count)</th>
                <th className="text-right px-4 py-2">Variance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <Wallet className="h-3.5 w-3.5 text-ink-soft" aria-hidden /> Cash on hand
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatEtb(cash.opening)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-money-in">
                  +{formatEtb(cash.inSum)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-money-out">
                  −{formatEtb(cash.outSum)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">
                  {formatEtb(cash.expected)}
                </td>
                <td className="px-2 py-2 text-right">
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cashActual}
                    onChange={(e) => setCashActual(e.target.value)}
                    className="h-8 text-right w-28 ml-auto"
                    aria-label="Actual cash on hand"
                  />
                </td>
                <td
                  className={
                    "px-4 py-2 text-right tabular-nums font-semibold " +
                    varianceClass(cash.variance)
                  }
                >
                  {cash.variance === null
                    ? "—"
                    : (cash.variance >= 0 ? "+" : "−") + formatEtb(Math.abs(cash.variance))}
                </td>
              </tr>
              {bankRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-soft">
                    No banks configured. Add accounts under Banks.
                  </td>
                </tr>
              ) : (
                bankRows.map((r) => (
                  <tr key={r.bank.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-semibold truncate">{r.bank.name}</div>
                      <div className="text-[10px] text-ink-soft">
                        {r.bank.channel} · {r.count} txn{r.count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatEtb(r.opening)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-money-in">
                      +{formatEtb(r.inSum)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-money-out">
                      −{formatEtb(r.outSum)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">
                      {formatEtb(r.expected)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.actualInput}
                        onChange={(e) =>
                          setBankActuals((s) => ({ ...s, [r.bank.id]: e.target.value }))
                        }
                        className="h-8 text-right w-28 ml-auto"
                        aria-label={`Actual balance ${r.bank.name}`}
                      />
                    </td>
                    <td
                      className={
                        "px-4 py-2 text-right tabular-nums font-semibold " +
                        varianceClass(r.variance)
                      }
                    >
                      {r.variance === null
                        ? "—"
                        : (r.variance >= 0 ? "+" : "−") + formatEtb(Math.abs(r.variance))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-muted/40 text-xs">
              <tr>
                <td className="px-4 py-2 font-semibold">Totals</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">
                  {formatEtb(grand.openingTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-money-in font-semibold">
                  +{formatEtb(grand.inTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-money-out font-semibold">
                  −{formatEtb(grand.outTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">
                  {formatEtb(grand.expectedTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-bold">
                  {formatEtb(grand.actualTotal)}
                </td>
                <td
                  className={
                    "px-4 py-2 text-right tabular-nums font-bold " + varianceClass(grand.variance)
                  }
                >
                  {(grand.variance >= 0 ? "+" : "−") + formatEtb(Math.abs(grand.variance))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Airtime table */}
      <section className="rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Radio className="h-4 w-4 text-airtime" aria-hidden />
          <h2 className="text-sm font-semibold">Airtime stock by distributor</h2>
        </header>
        {distRows.length === 0 ? (
          <p className="p-6 text-center text-xs text-ink-soft">
            No distributors configured. Add them under Distributors.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-ink-soft">
                <tr className="border-b border-border/60">
                  <th className="text-left px-4 py-2">Distributor</th>
                  <th className="text-right px-2 py-2">Kind</th>
                  <th className="text-right px-2 py-2">Opening</th>
                  <th className="text-right px-2 py-2">Received</th>
                  <th className="text-right px-2 py-2">Sent</th>
                  <th className="text-right px-2 py-2">Expected</th>
                  <th className="text-right px-2 py-2">Actual</th>
                  <th className="text-right px-4 py-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                {distRows.map((r) => (
                  <Fragment key={r.dist.id}>
                    <tr className="border-b border-border/30">
                      <td className="px-4 py-2" rowSpan={2}>
                        <Link
                          to="/distributors/$distributorId"
                          params={{ distributorId: r.dist.id }}
                          className="font-semibold truncate hover:text-primary hover:underline"
                        >
                          {r.dist.name}
                        </Link>
                        <div className="text-[10px] text-ink-soft">
                          {r.count} txn{r.count === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-airtime">EVD</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatEtb(r.evdOpen)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-in">
                        +{formatEtb(r.evd.received)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-out">
                        −{formatEtb(r.evd.sent)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {formatEtb(r.evdExpected)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={r.evdActualInput}
                          onChange={(e) =>
                            setEvdActuals((s) => ({ ...s, [r.dist.id]: e.target.value }))
                          }
                          className="h-8 text-right w-24 ml-auto"
                          aria-label={`Actual EVD stock ${r.dist.name}`}
                        />
                      </td>
                      <td
                        className={
                          "px-4 py-2 text-right tabular-nums font-semibold " +
                          varianceClass(r.evdVariance)
                        }
                      >
                        {r.evdVariance === null
                          ? "—"
                          : (r.evdVariance >= 0 ? "+" : "−") + formatEtb(Math.abs(r.evdVariance))}
                      </td>
                    </tr>
                    <tr className="border-b border-border/60 last:border-0">
                      <td className="px-2 py-2 text-right font-semibold text-credit">Float</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatEtb(r.fltOpen)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-in">
                        +{formatEtb(r.float.received)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-out">
                        −{formatEtb(r.float.sent)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {formatEtb(r.fltExpected)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={r.fltActualInput}
                          onChange={(e) =>
                            setFltActuals((s) => ({ ...s, [r.dist.id]: e.target.value }))
                          }
                          className="h-8 text-right w-24 ml-auto"
                          aria-label={`Actual float stock ${r.dist.name}`}
                        />
                      </td>
                      <td
                        className={
                          "px-4 py-2 text-right tabular-nums font-semibold " +
                          varianceClass(r.fltVariance)
                        }
                      >
                        {r.fltVariance === null
                          ? "—"
                          : (r.fltVariance >= 0 ? "+" : "−") + formatEtb(Math.abs(r.fltVariance))}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-ink-soft">
        Actual counts entered here are not saved — this is a live worksheet. Persist final closing
        figures from the{" "}
        <Link to="/close" className="underline">
          Close week
        </Link>{" "}
        screen.
      </p>
    </div>
  );
}
