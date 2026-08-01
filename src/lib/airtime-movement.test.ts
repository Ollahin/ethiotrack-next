import { describe, expect, it } from "vitest";
import {
  airtimeDirectionOf,
  airtimeStockDelta,
  isAirtimeTransaction,
  isInflowTransaction,
  transactionFlowSign,
} from "./airtime-movement";
import type { Transaction } from "./types";

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    type: "airtime_evd",
    amountSantim: 100_00,
    partyName: "Agent",
    channel: "Distributor",
    source: "manual",
    date: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("isAirtimeTransaction", () => {
  it("accepts EVD and Float only", () => {
    expect(isAirtimeTransaction(txn({ type: "airtime_evd" }))).toBe(true);
    expect(isAirtimeTransaction(txn({ type: "airtime_float" }))).toBe(true);
    for (const type of ["in", "out", "expense", "personal"] as const) {
      expect(isAirtimeTransaction(txn({ type }))).toBe(false);
    }
  });
});

describe("airtimeDirectionOf", () => {
  it("treats a legacy airtime transaction as sent", () => {
    expect(airtimeDirectionOf(txn({ airtimeDirection: undefined }))).toBe("sent");
  });

  it("preserves explicit directions", () => {
    expect(airtimeDirectionOf(txn({ airtimeDirection: "sent" }))).toBe("sent");
    expect(airtimeDirectionOf(txn({ airtimeDirection: "received" }))).toBe("received");
  });

  it("returns null for non-airtime transactions", () => {
    expect(airtimeDirectionOf(txn({ type: "in", airtimeDirection: "received" }))).toBeNull();
    expect(airtimeDirectionOf(txn({ type: "personal", airtimeDirection: "received" }))).toBeNull();
  });
});

describe("airtimeStockDelta", () => {
  it("legacy airtime decreases inventory", () => {
    expect(airtimeStockDelta(txn({ amountSantim: 250_00 }))).toBe(-250_00);
  });

  it("sent decreases inventory", () => {
    expect(airtimeStockDelta(txn({ airtimeDirection: "sent", amountSantim: 40_00 }))).toBe(-40_00);
  });

  it("received increases inventory", () => {
    expect(airtimeStockDelta(txn({ airtimeDirection: "received", amountSantim: 40_00 }))).toBe(
      40_00,
    );
  });

  it("keeps EVD and Float separate", () => {
    const rows = [
      txn({ id: "a", type: "airtime_evd", airtimeDirection: "received", amountSantim: 500_00 }),
      txn({ id: "b", type: "airtime_evd", amountSantim: 200_00 }),
      txn({ id: "c", type: "airtime_float", airtimeDirection: "received", amountSantim: 300_00 }),
      txn({ id: "d", type: "airtime_float", airtimeDirection: "sent", amountSantim: 125_00 }),
    ];
    const evd = rows
      .filter((r) => r.type === "airtime_evd")
      .reduce((s, r) => s + airtimeStockDelta(r), 0);
    const flt = rows
      .filter((r) => r.type === "airtime_float")
      .reduce((s, r) => s + airtimeStockDelta(r), 0);
    expect(evd).toBe(300_00);
    expect(flt).toBe(175_00);
  });

  it("bank and expense transactions never move airtime stock", () => {
    for (const type of ["in", "out", "expense", "personal"] as const) {
      expect(airtimeStockDelta(txn({ type, amountSantim: 999_00 }))).toBe(0);
    }
  });
});

describe("transactionFlowSign / isInflowTransaction", () => {
  it("presents received airtime as positive", () => {
    for (const type of ["airtime_evd", "airtime_float"] as const) {
      const t = txn({ type, airtimeDirection: "received" });
      expect(transactionFlowSign(t)).toBe(1);
      expect(isInflowTransaction(t)).toBe(true);
    }
  });

  it("presents sent and legacy airtime as negative", () => {
    for (const type of ["airtime_evd", "airtime_float"] as const) {
      expect(transactionFlowSign(txn({ type, airtimeDirection: "sent" }))).toBe(-1);
      expect(transactionFlowSign(txn({ type, airtimeDirection: undefined }))).toBe(-1);
      expect(isInflowTransaction(txn({ type, airtimeDirection: "sent" }))).toBe(false);
    }
  });

  it("leaves money transactions unchanged", () => {
    expect(transactionFlowSign(txn({ type: "in" }))).toBe(1);
    for (const type of ["out", "expense", "personal"] as const) {
      expect(transactionFlowSign(txn({ type }))).toBe(-1);
    }
  });

  it("classifies a history summary by direction", () => {
    const rows = [
      txn({ id: "a", type: "in", amountSantim: 100_00 }),
      txn({ id: "b", type: "out", amountSantim: 50_00 }),
      txn({ id: "c", type: "airtime_evd", airtimeDirection: "received", amountSantim: 300_00 }),
      txn({ id: "d", type: "airtime_float", airtimeDirection: "sent", amountSantim: 25_00 }),
      txn({ id: "e", type: "airtime_float", amountSantim: 5_00 }),
    ];
    let inSum = 0;
    let outSum = 0;
    for (const r of rows) {
      if (isInflowTransaction(r)) inSum += r.amountSantim;
      else outSum += r.amountSantim;
    }
    expect(inSum).toBe(400_00);
    expect(outSum).toBe(80_00);
  });
});

describe("reversal-aware stock semantics", () => {
  it("a sent reversal adds stock back but is not a receipt", () => {
    const rev = {
      type: "airtime_evd",
      airtimeDirection: "sent",
      isReversal: true,
      amountSantim: 1_000_00,
    } as const;
    expect(airtimeMovementKind(rev)).toBe("sent_reversal");
    expect(airtimeDirectionOf(rev)).toBe("sent");
    expect(airtimeStockDelta(rev)).toBe(1_000_00);
    expect(isReversalTransaction(rev)).toBe(true);
  });
});
