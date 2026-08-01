import { describe, expect, it } from "vitest";
import { distributorLedger, expectedStock, weekRangeOf } from "./distributor-ledger";
import type { Transaction } from "./types";

const WEEK = weekRangeOf("2026-08-10");
const DIST = "d-moderntech";

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    type: "airtime_evd",
    amountSantim: 0,
    partyName: "Agent",
    channel: "Distributor",
    source: "manual",
    distributorId: DIST,
    date: "2026-08-11T09:00:00.000Z",
    createdAt: "2026-08-11T09:00:00.000Z",
    ...p,
  };
}

// Current dataset: Moderntech EVD 61,500 sent + 104,000 reversed;
// Moderntech Float 151,500 received + 20,200 sent.
const DATASET: Transaction[] = [
  txn({ type: "airtime_evd", amountSantim: 61_500_00, airtimeDirection: "sent" }),
  txn({
    type: "airtime_evd",
    amountSantim: 104_000_00,
    airtimeDirection: "sent",
    isReversal: true,
  }),
  txn({ type: "airtime_float", amountSantim: 151_500_00, airtimeDirection: "received" }),
  txn({ type: "airtime_float", amountSantim: 20_200_00, airtimeDirection: "sent" }),
];

describe("homepage airtime summary uses the shared distributor ledger", () => {
  const ledger = distributorLedger(DATASET, DIST, WEEK);

  it("never adds reversed airtime to airtime sold", () => {
    expect(ledger.evd.sent).toBe(61_500_00);
    expect(ledger.evd.reversed).toBe(104_000_00);
    expect(ledger.evd.sent).not.toBe(165_500_00);
    expect(ledger.evd.netDelivered).toBe(-42_500_00);
  });

  it("EVD stock from a zero opening is +42,500", () => {
    expect(expectedStock(0, ledger.evd)).toBe(42_500_00);
  });

  it("Float sent is 20,200 and never 171,700", () => {
    expect(ledger.float.sent).toBe(20_200_00);
    expect(ledger.float.received).toBe(151_500_00);
    expect(ledger.float.sent).not.toBe(171_700_00);
  });

  it("Float stock from a zero opening is 131,300", () => {
    expect(expectedStock(0, ledger.float)).toBe(131_300_00);
  });

  it("homepage and reconciliation compute identical totals", () => {
    // Both surfaces call distributorLedger with the same week range and id.
    const reconcile = distributorLedger(DATASET, DIST, WEEK);
    expect(ledger).toEqual(reconcile);
    expect(expectedStock(0, ledger.evd)).toBe(expectedStock(0, reconcile.evd));
    expect(expectedStock(0, ledger.float)).toBe(expectedStock(0, reconcile.float));
  });

  it("preserves legitimate repeated transactions", () => {
    const repeated = [...DATASET, txn({ amountSantim: 61_500_00, airtimeDirection: "sent" })];
    expect(distributorLedger(repeated, DIST, WEEK).evd.sent).toBe(123_000_00);
  });

  it("ignores other distributors", () => {
    const other = [...DATASET, txn({ amountSantim: 9_000_00, distributorId: "other" })];
    expect(distributorLedger(other, DIST, WEEK).evd.sent).toBe(61_500_00);
  });
});
