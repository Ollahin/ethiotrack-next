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

/**
 * Signed inventory movement in santim for one transaction:
 * received → positive, sent (including legacy) → negative, otherwise zero.
 */
export function airtimeStockDelta(
  t: Pick<Transaction, "type" | "airtimeDirection" | "amountSantim">,
): number {
  const dir = airtimeDirectionOf(t);
  if (dir === null) return 0;
  return dir === "received" ? t.amountSantim : -t.amountSantim;
}

/**
 * Presentation sign for one transaction: +1 for value coming in
 * (money in, received airtime), -1 for value going out. Derived from the
 * same direction authority as `airtimeStockDelta`; never reads stored signs.
 */
export function transactionFlowSign(t: Pick<Transaction, "type" | "airtimeDirection">): 1 | -1 {
  const dir = airtimeDirectionOf(t);
  if (dir !== null) return dir === "received" ? 1 : -1;
  return t.type === "in" ? 1 : -1;
}

/** Whether a transaction should be counted as inflow in a summary. */
export function isInflowTransaction(t: Pick<Transaction, "type" | "airtimeDirection">): boolean {
  return transactionFlowSign(t) === 1;
}
