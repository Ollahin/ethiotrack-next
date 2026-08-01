// Pure distributor airtime ledger helpers.
//
// Every inventory number on the reconciliation page and on a distributor's
// history page is derived here, from `airtimeDirectionOf` / `airtimeStockDelta`
// only. Legacy airtime rows carry no direction and always mean "sent".
// Personal and non-airtime rows never move airtime stock. Visible rows are
// never merged or deduplicated — repeated transactions stay separate.

import {
  airtimeDirectionOf,
  airtimeMovementKind,
  airtimeStockDelta,
  isAirtimeTransaction,
  type AirtimeMovementKind,
} from "./airtime-movement";
import type { AirtimeDirection, Transaction } from "./types";

/** Inclusive YYYY-MM-DD calendar range (local dates as stored on the row). */
export interface DateRange {
  start: string;
  end: string;
}

export interface AirtimeMovement {
  received: number;
  /** Airtime that left towards agents, already net of reversals. */
  sent: number;
  /** Portion of earlier sent airtime given back by reversal rows. */
  reversed: number;
  /** received - sent (positive = stock grew). */
  net: number;
}

export interface DistributorLedger {
  count: number;
  evd: AirtimeMovement;
  float: AirtimeMovement;
}

const EMPTY: AirtimeMovement = { received: 0, sent: 0, reversed: 0, net: 0 };

/** Monday of the ISO week containing `d`, as YYYY-MM-DD (local calendar). */
export function weekStartOf(d: Date | string = new Date()): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return toISODate(dt);
}

/** Sunday closing the week that starts on `weekStart`. */
export function weekEndOf(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return toISODate(d);
}

/** Shift a week start by whole weeks — exactly 7 local calendar days each. */
export function shiftWeekStart(weekStart: string, weeks: number): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return toISODate(d);
}

export function weekRangeOf(weekStart: string): DateRange {
  return { start: weekStart, end: weekEndOf(weekStart) };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whether a transaction's calendar day falls inside an inclusive range. */
export function isInRange(t: Pick<Transaction, "date">, range: DateRange): boolean {
  const d = t.date.slice(0, 10);
  return d >= range.start && d <= range.end;
}

/**
 * Airtime rows belonging to one distributor, optionally limited to a range.
 * Another distributor's rows, personal rows and money rows never appear.
 * Ordering of the input is preserved; nothing is merged.
 */
export function distributorTransactions(
  txns: Transaction[],
  distributorId: string,
  range?: DateRange,
): Transaction[] {
  return txns.filter(
    (t) =>
      t.distributorId === distributorId &&
      isAirtimeTransaction(t) &&
      !t.isPersonal &&
      (!range || isInRange(t, range)),
  );
}

/** Movement totals for a set of rows already narrowed to one airtime form. */
function movementOf(rows: Transaction[]): AirtimeMovement {
  let received = 0;
  let sent = 0;
  let reversed = 0;
  for (const t of rows) {
    const kind = airtimeMovementKind(t);
    if (kind === "received") received += t.amountSantim;
    else if (kind === "sent") sent += t.amountSantim;
    else if (kind === "sent_reversal") reversed += t.amountSantim;
  }
  // A reversal is not a receipt: it reduces the airtime actually delivered.
  const netSent = sent - reversed;
  return { received, sent: netSent, reversed, net: received - netSent };
}

/** Count, EVD and Float received/sent/net for one distributor in a range. */
export function distributorLedger(
  txns: Transaction[],
  distributorId: string,
  range?: DateRange,
): DistributorLedger {
  const rows = distributorTransactions(txns, distributorId, range);
  if (rows.length === 0) return { count: 0, evd: { ...EMPTY }, float: { ...EMPTY } };
  return {
    count: rows.length,
    evd: movementOf(rows.filter((t) => t.type === "airtime_evd")),
    float: movementOf(rows.filter((t) => t.type === "airtime_float")),
  };
}

/** Expected closing stock: opening + received - sent. */
export function expectedStock(opening: number, movement: AirtimeMovement): number {
  return opening + movement.received - movement.sent;
}

/** Display direction of one airtime row; legacy rows read as "sent". */
export function rowDirection(t: Transaction): AirtimeDirection {
  return airtimeDirectionOf(t) ?? "sent";
}

/** Display movement kind of one airtime row; legacy rows read as "sent". */
export function rowMovementKind(t: Transaction): AirtimeMovementKind {
  return airtimeMovementKind(t) ?? "sent";
}

/** Signed stock effect of one row, for display next to the amount. */
export function rowStockDelta(t: Transaction): number {
  return airtimeStockDelta(t);
}
