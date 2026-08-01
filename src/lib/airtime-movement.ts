// Sent-versus-received airtime semantics.
//
// Airtime transactions historically only ever recorded stock leaving the
// subdistributor (airtime distributed to an agent). Receipts from an upstream
// distributor now need to be representable on the same transaction shape, so
// `Transaction.airtimeDirection` is optional and a missing value means "sent".
// This module is the single source of truth for that interpretation; every
// inventory calculation must derive its sign from `airtimeStockDelta`.

import type { AirtimeDirection, Transaction, TxnType } from "./types";

export type AirtimeTxnType = Extract<TxnType, "airtime_evd" | "airtime_float">;

/**
 * What an airtime row does to stock:
 *  - "received": airtime arrived from an upstream distributor,
 *  - "sent": airtime left towards an agent,
 *  - "sent_reversal": a distributor Sent-screen reversal that undoes an
 *    earlier sent movement. It is NOT a distributor receipt: stock goes back
 *    up, but no new airtime was bought or received.
 */
export type AirtimeMovementKind = "received" | "sent" | "sent_reversal";

/** Airtime-bearing transaction types. Money and personal rows are excluded. */
export function isAirtimeTransaction(t: Pick<Transaction, "type">): boolean {
  return t.type === "airtime_evd" || t.type === "airtime_float";
}

/**
 * The recorded direction of an airtime transaction. Legacy rows carry no
 * field and always mean "sent". Non-airtime rows have no direction at all.
 */
export function airtimeDirectionOf(
  t: Pick<Transaction, "type" | "airtimeDirection">,
): AirtimeDirection | null {
  if (!isAirtimeTransaction(t)) return null;
  return t.airtimeDirection === "received" ? "received" : "sent";
}

/** A reversal of an airtime row, as read from the source statement. */
export function isReversalTransaction(t: Pick<Transaction, "type" | "isReversal">): boolean {
  return isAirtimeTransaction(t) && t.isReversal === true;
}

/**
 * The movement kind of one airtime row. Reversal evidence is stored on the
 * row itself, so a reversal never has to be disguised as a receipt.
 */
export function airtimeMovementKind(
  t: Pick<Transaction, "type" | "airtimeDirection" | "isReversal">,
): AirtimeMovementKind | null {
  const dir = airtimeDirectionOf(t);
  if (dir === null) return null;
  if (dir === "sent" && t.isReversal === true) return "sent_reversal";
  return dir;
}

/**
 * Signed inventory movement in santim for one transaction: received →
 * positive, sent (including legacy) → negative, sent reversal → positive
 * (it gives back exactly the earlier sent amount), otherwise zero.
 */
export function airtimeStockDelta(
  t: Pick<Transaction, "type" | "airtimeDirection" | "isReversal" | "amountSantim">,
): number {
  const kind = airtimeMovementKind(t);
  if (kind === null) return 0;
  return kind === "sent" ? -t.amountSantim : t.amountSantim;
}

/**
 * Presentation sign for one transaction: +1 for value coming in
 * (money in, received airtime, reversed-out airtime), -1 for value going out.
 * Derived from the same authority as `airtimeStockDelta`.
 */
export function transactionFlowSign(
  t: Pick<Transaction, "type" | "airtimeDirection" | "isReversal">,
): 1 | -1 {
  const kind = airtimeMovementKind(t);
  if (kind !== null) return kind === "sent" ? -1 : 1;
  return t.type === "in" ? 1 : -1;
}

/** Whether a transaction should be counted as inflow in a summary. */
export function isInflowTransaction(
  t: Pick<Transaction, "type" | "airtimeDirection" | "isReversal">,
): boolean {
  return transactionFlowSign(t) === 1;
}
