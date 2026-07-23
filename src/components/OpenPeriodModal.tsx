import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openPeriod, useBanks, useDistributors, getWeekEnd, usePreviousPeriodExpected } from "@/lib/db";
import { formatEtb, parseEtbToSantim } from "@/lib/format";
import type { PeriodOpening } from "@/lib/types";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

/** Validate a user-entered ETB amount. Empty is treated as 0. */
function parseAmount(input: string): { santim: number; error: string | null } {
  const raw = input.trim();
  if (!raw) return { santim: 0, error: null };
  const santim = parseEtbToSantim(raw);
  if (santim === null) return { santim: 0, error: "Invalid amount" };
  if (santim < 0) return { santim: 0, error: "Must be ≥ 0" };
  if (santim > 1_000_000_000_00) return { santim: 0, error: "Amount too large" };
  return { santim, error: null };
}

export function OpenPeriodModal({
  weekStart,
  open,
  existing,
  onOpened,
  onCancel,
}: {
  weekStart: string;
  open: boolean;
  existing?: PeriodOpening | null;
  onOpened: () => void;
  onCancel?: () => void;
}) {
  const banks = useBanks();
  const distributors = useDistributors();
  const expected = usePreviousPeriodExpected(weekStart);
  const [cash, setCash] = useState(existing ? (existing.cashOnHandSantim / 100).toString() : "");
  const [bankBal, setBankBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing) for (const [k, v] of Object.entries(existing.bankBalances)) o[k] = (v / 100).toString();
    return o;
  });
  const [evdBal, setEvdBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing?.evdStockByDistributor)
      for (const [k, v] of Object.entries(existing.evdStockByDistributor)) o[k] = (v / 100).toString();
    return o;
  });
  const [fltBal, setFltBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing?.floatStockByDistributor)
      for (const [k, v] of Object.entries(existing.floatStockByDistributor)) o[k] = (v / 100).toString();
    return o;
  });
  const [saving, setSaving] = useState(false);
  const weekEnd = getWeekEnd(weekStart);

  const totals = useMemo(() => {
    const cashParsed = parseAmount(cash);
    const errors: string[] = [];
    if (cashParsed.error) errors.push(`Cash: ${cashParsed.error}`);

    const bankParsed: Record<string, { santim: number; error: string | null }> = {};
    let bankTotal = 0;
    for (const b of banks) {
      const p = parseAmount(bankBal[b.id] ?? "");
      bankParsed[b.id] = p;
      bankTotal += p.santim;
      if (p.error) errors.push(`${b.name}: ${p.error}`);
    }

    const evdParsed: Record<string, { santim: number; error: string | null }> = {};
    const fltParsed: Record<string, { santim: number; error: string | null }> = {};
    let evdTotal = 0;
    let fltTotal = 0;
    for (const d of distributors) {
      const e = parseAmount(evdBal[d.id] ?? "");
      const f = parseAmount(fltBal[d.id] ?? "");
      evdParsed[d.id] = e;
      fltParsed[d.id] = f;
      evdTotal += e.santim;
      fltTotal += f.santim;
      if (e.error) errors.push(`${d.name} EVD: ${e.error}`);
      if (f.error) errors.push(`${d.name} Float: ${f.error}`);
    }

    return {
      cashSantim: cashParsed.santim,
      bankParsed,
      evdParsed,
      fltParsed,
      bankTotal,
      evdTotal,
      fltTotal,
      moneyTotal: cashParsed.santim + bankTotal,
      grandTotal: cashParsed.santim + bankTotal + evdTotal + fltTotal,
      errors,
    };
  }, [cash, bankBal, evdBal, fltBal, banks, distributors]);

  const invalid = totals.errors.length > 0;

  /** Small helper: given expected & entered santim, return match state + delta. */
  function diffState(exp: number | undefined, entered: number) {
    if (exp === undefined) return { state: "none" as const, delta: 0 };
    const delta = entered - exp;
    if (delta === 0) return { state: "match" as const, delta };
    return { state: "mismatch" as const, delta };
  }

  const expectedCash = expected?.cashSantim;
  const expectedBankTotal = expected
    ? banks.reduce((s, b) => s + (expected.bankBalances[b.id] ?? 0), 0)
    : undefined;
  const expectedEvdTotal = expected
    ? distributors.reduce((s, d) => s + (expected.evdStockByDistributor[d.id] ?? 0), 0)
    : undefined;
  const expectedFltTotal = expected
    ? distributors.reduce((s, d) => s + (expected.floatStockByDistributor[d.id] ?? 0), 0)
    : undefined;
  const expectedGrand =
    expected !== undefined && expected !== null
      ? (expectedCash ?? 0) + (expectedBankTotal ?? 0) + (expectedEvdTotal ?? 0) + (expectedFltTotal ?? 0)
      : undefined;

  // Count mismatched fields for the header summary.
  const mismatchCount = (() => {
    if (!expected) return 0;
    let n = 0;
    if ((expected.cashSantim ?? 0) !== totals.cashSantim) n++;
    for (const b of banks) {
      const exp = expected.bankBalances[b.id] ?? 0;
      if (exp !== (totals.bankParsed[b.id]?.santim ?? 0)) n++;
    }
    for (const d of distributors) {
      const eExp = expected.evdStockByDistributor[d.id] ?? 0;
      const fExp = expected.floatStockByDistributor[d.id] ?? 0;
      if (eExp !== (totals.evdParsed[d.id]?.santim ?? 0)) n++;
      if (fExp !== (totals.fltParsed[d.id]?.santim ?? 0)) n++;
    }
    return n;
  })();

  function autoFillFromExpected() {
    if (!expected) return;
    setCash(((expected.cashSantim ?? 0) / 100).toString());
    setBankBal(() => {
      const o: Record<string, string> = {};
      for (const b of banks) o[b.id] = ((expected.bankBalances[b.id] ?? 0) / 100).toString();
      return o;
    });
    setEvdBal(() => {
      const o: Record<string, string> = {};
      for (const d of distributors) o[d.id] = ((expected.evdStockByDistributor[d.id] ?? 0) / 100).toString();
      return o;
    });
    setFltBal(() => {
      const o: Record<string, string> = {};
      for (const d of distributors) o[d.id] = ((expected.floatStockByDistributor[d.id] ?? 0) / 100).toString();
      return o;
    });
  }

  async function save() {
    if (invalid) {
      toast.error(totals.errors[0]);
      return;
    }
    setSaving(true);
    try {
      const bankBalances: Record<string, number> = {};
      for (const b of banks) bankBalances[b.id] = totals.bankParsed[b.id].santim;
      const evdStockByDistributor: Record<string, number> = {};
      const floatStockByDistributor: Record<string, number> = {};
      for (const d of distributors) {
        evdStockByDistributor[d.id] = totals.evdParsed[d.id].santim;
        floatStockByDistributor[d.id] = totals.fltParsed[d.id].santim;
      }
      await openPeriod({
        weekStart,
        cashOnHandSantim: totals.cashSantim,
        bankBalances,
        evdStockByDistributor,
        floatStockByDistributor,
        evdStockSantim: totals.evdTotal,
        floatStockSantim: totals.fltTotal,
      });
      toast.success(existing ? "Opening updated" : "Week opened");
      onOpened();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && onCancel) onCancel(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Adjust opening balance" : "Open the week"}</DialogTitle>
          <DialogDescription>
            Set starting balances per bank and per airtime distributor for the week of {weekStart} → {weekEnd}. Every field is optional — fill in what you know now and adjust anytime before closing the week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {banks.length === 0 && distributors.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-[11px] space-y-2">
              <p className="text-ink-soft">
                You haven't added any banks, wallets or distributors yet. You can skip this for now and set them up first.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to="/banks" className="text-primary underline underline-offset-2">Add banks / wallets</Link>
                <span className="text-ink-soft">·</span>
                <Link to="/distributors" className="text-primary underline underline-offset-2">Add distributors</Link>
                <span className="text-ink-soft">·</span>
                <Link to="/agents" className="text-primary underline underline-offset-2">Add agents</Link>
              </div>
            </div>
          )}
          {expected && (
            <div className="rounded-xl border border-border/60 bg-primary/5 p-3 text-[11px] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-soft">
                  Expected carry-forward from week of{" "}
                  <span className="font-medium text-foreground">{expected.prevWeekStart}</span>
                </span>
                <button
                  type="button"
                  onClick={autoFillFromExpected}
                  className="text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  Use expected
                </button>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">Expected weekly total</span>
                <span className="tabular-nums font-semibold">{formatEtb(expectedGrand ?? 0)}</span>
              </div>
              {mismatchCount > 0 ? (
                <div className="text-destructive">
                  {mismatchCount} field{mismatchCount === 1 ? "" : "s"} differ from expected.
                </div>
              ) : (
                <div className="text-emerald-600 dark:text-emerald-400">All entries match expected carry-forward.</div>
              )}
            </div>
          )}
          <div>
            <Label>Cash on hand (ETB) <span className="text-ink-soft font-normal">· optional</span></Label>
            <Input
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="Leave blank if none"
              aria-invalid={parseAmount(cash).error ? true : undefined}
              className={
                expectedCash !== undefined && expectedCash !== totals.cashSantim && !parseAmount(cash).error
                  ? "border-amber-500/70 focus-visible:ring-amber-500"
                  : undefined
              }
            />
            {parseAmount(cash).error && (
              <p className="text-[10px] text-destructive mt-1">{parseAmount(cash).error}</p>
            )}
            {expectedCash !== undefined && !parseAmount(cash).error && (() => {
              const d = diffState(expectedCash, totals.cashSantim);
              if (d.state === "match")
                return <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">Matches expected {formatEtb(expectedCash)}.</p>;
              return (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  Expected {formatEtb(expectedCash)} · {d.delta > 0 ? "+" : ""}{formatEtb(d.delta)}
                </p>
              );
            })()}
          </div>
          {banks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-ink-soft">Bank / wallet balances</Label>
                <span className="text-[10px] text-ink-soft tabular-nums">
                  Subtotal <span className="font-semibold text-foreground">{formatEtb(totals.bankTotal)}</span>
                  {expectedBankTotal !== undefined && (
                    <span
                      className={
                        expectedBankTotal === totals.bankTotal
                          ? " text-emerald-600 dark:text-emerald-400 ml-1"
                          : " text-amber-600 dark:text-amber-400 ml-1"
                      }
                    >
                      / exp {formatEtb(expectedBankTotal)}
                    </span>
                  )}
                </span>
              </div>
              {banks.map((b) => {
                const p = totals.bankParsed[b.id];
                const exp = expected?.bankBalances[b.id];
                const d = diffState(exp, p?.santim ?? 0);
                const mismatch = d.state === "mismatch" && !p?.error;
                return (
                  <div key={b.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs w-28 truncate">{b.name}</div>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={bankBal[b.id] ?? ""}
                        onChange={(e) => setBankBal((s) => ({ ...s, [b.id]: e.target.value }))}
                        aria-invalid={p?.error ? true : undefined}
                        className={mismatch ? "border-amber-500/70 focus-visible:ring-amber-500" : undefined}
                      />
                    </div>
                    {p?.error && <p className="text-[10px] text-destructive ml-[7.5rem]">{p.error}</p>}
                    {!p?.error && exp !== undefined && (
                      d.state === "match" ? (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-[7.5rem]">
                          Matches expected {formatEtb(exp)}.
                        </p>
                      ) : (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 ml-[7.5rem]">
                          Expected {formatEtb(exp)} · {d.delta > 0 ? "+" : ""}{formatEtb(d.delta)}
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {distributors.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-ink-soft">Airtime stock by distributor</Label>
                <span className="text-[10px] text-ink-soft tabular-nums">
                  EVD <span className="font-semibold text-foreground">{formatEtb(totals.evdTotal)}</span>
                  {expectedEvdTotal !== undefined && (
                    <span className={expectedEvdTotal === totals.evdTotal ? " text-emerald-600 dark:text-emerald-400" : " text-amber-600 dark:text-amber-400"}>
                      /exp {formatEtb(expectedEvdTotal)}
                    </span>
                  )}
                  {" · "}
                  Float <span className="font-semibold text-foreground">{formatEtb(totals.fltTotal)}</span>
                  {expectedFltTotal !== undefined && (
                    <span className={expectedFltTotal === totals.fltTotal ? " text-emerald-600 dark:text-emerald-400" : " text-amber-600 dark:text-amber-400"}>
                      /exp {formatEtb(expectedFltTotal)}
                    </span>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] uppercase tracking-wide text-ink-soft">
                <div>Distributor</div><div>EVD</div><div>Float</div>
              </div>
              {distributors.map((d) => {
                const e = totals.evdParsed[d.id];
                const f = totals.fltParsed[d.id];
                const eExp = expected?.evdStockByDistributor[d.id];
                const fExp = expected?.floatStockByDistributor[d.id];
                const eDiff = diffState(eExp, e?.santim ?? 0);
                const fDiff = diffState(fExp, f?.santim ?? 0);
                const eMismatch = eDiff.state === "mismatch" && !e?.error;
                const fMismatch = fDiff.state === "mismatch" && !f?.error;
                return (
                  <div key={d.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                      <div className="text-xs truncate">
                        <div>{d.name}</div>
                        <div className="text-[10px] text-ink-soft tabular-nums">
                          {formatEtb((e?.santim ?? 0) + (f?.santim ?? 0))}
                        </div>
                      </div>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={evdBal[d.id] ?? ""}
                        onChange={(ev) => setEvdBal((s) => ({ ...s, [d.id]: ev.target.value }))}
                        aria-invalid={e?.error ? true : undefined}
                        className={eMismatch ? "border-amber-500/70 focus-visible:ring-amber-500" : undefined}
                      />
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={fltBal[d.id] ?? ""}
                        onChange={(ev) => setFltBal((s) => ({ ...s, [d.id]: ev.target.value }))}
                        aria-invalid={f?.error ? true : undefined}
                        className={fMismatch ? "border-amber-500/70 focus-visible:ring-amber-500" : undefined}
                      />
                    </div>
                    {(e?.error || f?.error) && (
                      <p className="text-[10px] text-destructive">{e?.error ?? f?.error}</p>
                    )}
                    {!e?.error && !f?.error && (eExp !== undefined || fExp !== undefined) && (
                      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] tabular-nums">
                        <div />
                        {eExp !== undefined ? (
                          eDiff.state === "match" ? (
                            <span className="text-emerald-600 dark:text-emerald-400">exp {formatEtb(eExp)}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">exp {formatEtb(eExp)} · {eDiff.delta > 0 ? "+" : ""}{formatEtb(eDiff.delta)}</span>
                          )
                        ) : <div />}
                        {fExp !== undefined ? (
                          fDiff.state === "match" ? (
                            <span className="text-emerald-600 dark:text-emerald-400">exp {formatEtb(fExp)}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">exp {formatEtb(fExp)} · {fDiff.delta > 0 ? "+" : ""}{formatEtb(fDiff.delta)}</span>
                          )
                        ) : <div />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              Add distributors first to record per-distributor EVD/Float opening stock.
            </p>
          )}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-ink-soft">Money on hand (cash + banks)</span>
              <span className="tabular-nums font-semibold">{formatEtb(totals.moneyTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-soft">Airtime stock (EVD + Float)</span>
              <span className="tabular-nums font-semibold">{formatEtb(totals.evdTotal + totals.fltTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-1 mt-1">
              <span className="font-semibold">Weekly opening total</span>
              <span className="tabular-nums font-bold text-primary">{formatEtb(totals.grandTotal)}</span>
            </div>
            {expectedGrand !== undefined && (
              <div className="flex justify-between">
                <span className="text-ink-soft">vs expected {formatEtb(expectedGrand)}</span>
                <span
                  className={
                    "tabular-nums font-semibold " +
                    (totals.grandTotal === expectedGrand
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400")
                  }
                >
                  {totals.grandTotal - expectedGrand > 0 ? "+" : ""}
                  {formatEtb(totals.grandTotal - expectedGrand)}
                </span>
              </div>
            )}
          </div>
          {invalid && (
            <p className="text-[11px] text-destructive" role="alert">
              Fix {totals.errors.length} field{totals.errors.length === 1 ? "" : "s"} before saving.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button className="w-full" onClick={save} disabled={saving || invalid}>
              {saving ? "Saving…" : existing ? "Save opening" : "Open week"}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={onCancel}
                disabled={saving}
              >
                {existing ? "Cancel" : "Skip for now"}
              </Button>
            )}
          </div>
          {!existing && (
            <p className="text-[10px] text-ink-soft text-center">
              You can open or adjust the week later from the dashboard.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}