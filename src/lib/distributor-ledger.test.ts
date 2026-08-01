import { describe, expect, it } from "vitest";
import {
  distributorLedger,
  distributorTransactions,
  expectedStock,
  isInRange,
  rowDirection,
  shiftWeekStart,
  weekEndOf,
  weekRangeOf,
  weekStartOf,
} from "./distributor-ledger";
import type { Transaction } from "./types";

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: "t",
    type: "airtime_evd",
    amountSantim: 100_00,
    partyName: "Agent",
    channel: "Distributor",
    source: "manual",
    date: "2026-08-11T09:00:00.000Z",
    createdAt: "2026-08-11T09:00:00.000Z",
    ...p,
  };
}

describe("week navigation", () => {
  it("defaults to the current week (Monday → Sunday)", () => {
    const start = weekStartOf();
    const d = new Date(start + "T00:00:00");
    expect(d.getDay()).toBe(1);
    expect(new Date(weekEndOf(start) + "T00:00:00").getDay()).toBe(0);
  });

  it("previous and next move exactly seven local calendar days", () => {
    const start = "2026-08-10";
    expect(shiftWeekStart(start, -1)).toBe("2026-08-03");
    expect(shiftWeekStart(start, 1)).toBe("2026-08-17");
    const diff =
      (new Date("2026-08-17T00:00:00").getTime() - new Date("2026-08-10T00:00:00").getTime()) /
      86_400_000;
    expect(diff).toBe(7);
  });

  it("the August 10–16 week covers August 11, 13 and 14", () => {
    const range = weekRangeOf("2026-08-10");
    expect(range).toEqual({ start: "2026-08-10", end: "2026-08-16" });
    for (const day of ["2026-08-11", "2026-08-13", "2026-08-14"]) {
      expect(isInRange(txn({ date: `${day}T10:00:00.000Z` }), range)).toBe(true);
    }
    expect(isInRange(txn({ date: "2026-08-17T10:00:00.000Z" }), range)).toBe(false);
    expect(isInRange(txn({ date: "2026-08-09T10:00:00.000Z" }), range)).toBe(false);
  });
});

describe("distributor filtering", () => {
  const rows = [
    txn({ id: "a", distributorId: "d1" }),
    txn({ id: "b", distributorId: "d2" }),
    txn({ id: "c", distributorId: "d1", type: "in" }),
    txn({ id: "d", distributorId: "d1", isPersonal: true }),
  ];

  it("never includes another distributor's transactions", () => {
    expect(distributorTransactions(rows, "d1").map((t) => t.id)).toEqual(["a"]);
    expect(distributorTransactions(rows, "d2").map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps repeated transactions separate", () => {
    const repeated = [
      txn({ id: "r1", distributorId: "d1", amountSantim: 5_000_00 }),
      txn({ id: "r2", distributorId: "d1", amountSantim: 5_000_00 }),
    ];
    const led = distributorLedger(repeated, "d1");
    expect(led.count).toBe(2);
    expect(led.evd.sent).toBe(10_000_00);
  });

  it("keeps all recent activity available when no range is given", () => {
    const recent = [
      txn({ id: "old", distributorId: "d1", date: "2026-06-01T09:00:00.000Z" }),
      txn({ id: "mid", distributorId: "d1", date: "2026-07-15T09:00:00.000Z" }),
      txn({ id: "new", distributorId: "d1", date: "2026-08-11T09:00:00.000Z" }),
    ];
    expect(distributorTransactions(recent, "d1")).toHaveLength(3);
    expect(distributorTransactions(recent, "d1", weekRangeOf("2026-08-10"))).toHaveLength(1);
  });
});

describe("distributorLedger", () => {
  it("Sample Distributor A: EVD received 20,000, sent 0, expected 20,000", () => {
    const rows = [
      txn({
        id: "a1",
        distributorId: "distA",
        type: "airtime_evd",
        airtimeDirection: "received",
        amountSantim: 20_000_00,
        date: "2026-08-11T08:00:00.000Z",
      }),
    ];
    const led = distributorLedger(rows, "distA", weekRangeOf("2026-08-10"));
    expect(led.evd).toEqual({ received: 20_000_00, sent: 0, net: 20_000_00 });
    expect(expectedStock(0, led.evd)).toBe(20_000_00);
  });

  it("Sample Shop A: Float received 500,000, sent 45,000, expected 455,000", () => {
    const rows = [
      txn({
        id: "f1",
        distributorId: "shopA",
        type: "airtime_float",
        airtimeDirection: "received",
        amountSantim: 500_000_00,
        date: "2026-08-13T08:00:00.000Z",
      }),
      txn({
        id: "f2",
        distributorId: "shopA",
        type: "airtime_float",
        airtimeDirection: "sent",
        amountSantim: 45_000_00,
        date: "2026-08-14T08:00:00.000Z",
      }),
    ];
    const led = distributorLedger(rows, "shopA", weekRangeOf("2026-08-10"));
    expect(led.count).toBe(2);
    expect(led.float).toEqual({ received: 500_000_00, sent: 45_000_00, net: 455_000_00 });
    expect(expectedStock(0, led.float)).toBe(455_000_00);
  });

  it("shows zero movement for unrelated weeks", () => {
    const rows = [
      txn({
        id: "x",
        distributorId: "distA",
        airtimeDirection: "received",
        amountSantim: 20_000_00,
        date: "2026-08-11T08:00:00.000Z",
      }),
    ];
    const led = distributorLedger(rows, "distA", weekRangeOf("2026-08-17"));
    expect(led).toEqual({
      count: 0,
      evd: { received: 0, sent: 0, net: 0 },
      float: { received: 0, sent: 0, net: 0 },
    });
  });

  it("computes received / sent / net separately for EVD and Float", () => {
    const rows = [
      txn({ id: "1", distributorId: "d", airtimeDirection: "received", amountSantim: 800_00 }),
      txn({ id: "2", distributorId: "d", airtimeDirection: "sent", amountSantim: 300_00 }),
      txn({
        id: "3",
        distributorId: "d",
        type: "airtime_float",
        airtimeDirection: "received",
        amountSantim: 1_000_00,
      }),
      txn({
        id: "4",
        distributorId: "d",
        type: "airtime_float",
        airtimeDirection: "sent",
        amountSantim: 250_00,
      }),
    ];
    const led = distributorLedger(rows, "d");
    expect(led.count).toBe(4);
    expect(led.evd).toEqual({ received: 800_00, sent: 300_00, net: 500_00 });
    expect(led.float).toEqual({ received: 1_000_00, sent: 250_00, net: 750_00 });
  });

  it("counts legacy airtime rows without a direction as sent", () => {
    const rows = [
      txn({ id: "l", distributorId: "d", airtimeDirection: undefined, amountSantim: 700_00 }),
    ];
    expect(rowDirection(rows[0])).toBe("sent");
    expect(distributorLedger(rows, "d").evd).toEqual({
      received: 0,
      sent: 700_00,
      reversed: 0,
      net: -700_00,
    });
  });

  it("expected stock is opening + received - sent", () => {
    expect(expectedStock(10_000_00, { received: 5_000_00, sent: 2_000_00, reversed: 0, net: 3_000_00 })).toBe(
      13_000_00,
    );
  });
});

describe("distributor reversal semantics", () => {
  it("a sent reversal gives stock back without counting as a receipt", () => {
    const rows = [
      txn({ id: "s", type: "airtime_evd", amountSantim: 5_000_00 }),
      txn({
        id: "r",
        type: "airtime_evd",
        amountSantim: 1_000_00,
        airtimeDirection: "sent",
        isReversal: true,
      }),
    ];
    const evd = distributorLedger(rows, "d").evd;
    expect(evd).toEqual({ received: 0, sent: 4_000_00, reversed: 1_000_00, net: -4_000_00 });
    expect(rowMovementKind(rows[1])).toBe("sent_reversal");
    expect(expectedStock(10_000_00, evd)).toBe(6_000_00);
  });
});
