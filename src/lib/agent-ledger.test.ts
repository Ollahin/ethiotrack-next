import { describe, expect, it } from "vitest";
import { agentLedger, agentTransactions, isAirtimeSentToAgent } from "./agent-ledger";
import { shiftWeekStart, weekRangeOf } from "./distributor-ledger";
import type { Transaction } from "./types";

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: "t",
    type: "airtime_evd",
    amountSantim: 100_00,
    partyName: "Agent",
    partyId: "a1",
    channel: "Distributor",
    source: "manual",
    date: "2026-08-11T09:00:00.000Z",
    createdAt: "2026-08-11T09:00:00.000Z",
    ...p,
  };
}

describe("agentTransactions", () => {
  const rows = [
    txn({ id: "a", partyId: "a1" }),
    txn({ id: "b", partyId: "a2" }),
    txn({ id: "c", partyId: undefined, partyName: "Agent" }),
  ];

  it("filters strictly by agent id", () => {
    expect(agentTransactions(rows, "a1").map((t) => t.id)).toEqual(["a"]);
    expect(agentTransactions(rows, "a2").map((t) => t.id)).toEqual(["b"]);
  });

  it("never matches by name when the id is missing", () => {
    expect(agentTransactions(rows, "a3")).toEqual([]);
    expect(agentTransactions(rows, "")).toEqual([]);
  });

  it("keeps repeated identical rows separate", () => {
    const repeated = [
      txn({ id: "r1", amountSantim: 5_000_00 }),
      txn({ id: "r2", amountSantim: 5_000_00 }),
    ];
    expect(agentTransactions(repeated, "a1")).toHaveLength(2);
    expect(agentLedger(repeated, "a1").evdSent).toBe(10_000_00);
  });
});

describe("agentLedger", () => {
  const week = weekRangeOf("2026-08-10");

  it("totals EVD sent, Float sent and cash received", () => {
    const rows = [
      txn({ id: "1", type: "airtime_evd", amountSantim: 2_000_00 }),
      txn({ id: "2", type: "airtime_float", amountSantim: 1_500_00 }),
      txn({ id: "3", type: "in", amountSantim: 1_000_00 }),
      txn({ id: "4", partyId: "other", type: "in", amountSantim: 9_999_00 }),
    ];
    const led = agentLedger(rows, "a1", week);
    expect(led.count).toBe(3);
    expect(led.evdSent).toBe(2_000_00);
    expect(led.floatSent).toBe(1_500_00);
    expect(led.cashIn).toBe(1_000_00);
  });

  it("excludes incoming distributor receipts from airtime delivered", () => {
    const received = txn({ id: "r", airtimeDirection: "received", amountSantim: 20_000_00 });
    expect(isAirtimeSentToAgent(received)).toBe(false);
    const led = agentLedger([received], "a1");
    expect(led.count).toBe(1);
    expect(led.evdSent).toBe(0);
    expect(led.openCredit).toBe(0);
  });

  it("counts legacy direction-less airtime as sent", () => {
    const led = agentLedger([txn({ id: "l", airtimeDirection: undefined })], "a1");
    expect(led.evdSent).toBe(100_00);
  });

  it("tracks open credit and unsettled count", () => {
    const rows = [
      txn({ id: "u1", amountSantim: 3_000_00 }),
      txn({ id: "s1", amountSantim: 4_000_00, isSettled: true }),
      txn({ id: "u2", type: "airtime_float", amountSantim: 500_00 }),
    ];
    const led = agentLedger(rows, "a1");
    expect(led.openCredit).toBe(3_500_00);
    expect(led.unsettledCount).toBe(2);
  });

  it("returns an empty ledger for an unknown agent id", () => {
    expect(agentLedger([txn({ id: "x" })], "nope")).toEqual({
      count: 0,
      evdSent: 0,
      floatSent: 0,
      cashIn: 0,
      openCredit: 0,
      unsettledCount: 0,
    });
  });
});

describe("agent week navigation", () => {
  it("moves exactly seven local calendar days", () => {
    expect(shiftWeekStart("2026-08-10", -1)).toBe("2026-08-03");
    expect(shiftWeekStart("2026-08-10", 1)).toBe("2026-08-17");
  });

  it("the August 10–16 week keeps only that week's rows", () => {
    const rows = [
      txn({ id: "in", date: "2026-08-13T09:00:00.000Z" }),
      txn({ id: "before", date: "2026-08-09T09:00:00.000Z" }),
      txn({ id: "after", date: "2026-08-17T09:00:00.000Z" }),
    ];
    expect(agentTransactions(rows, "a1", weekRangeOf("2026-08-10")).map((t) => t.id)).toEqual([
      "in",
    ]);
  });

  it("all-recent mode retains the full history", () => {
    const rows = [
      txn({ id: "old", date: "2026-06-01T09:00:00.000Z" }),
      txn({ id: "new", date: "2026-08-13T09:00:00.000Z" }),
    ];
    expect(agentTransactions(rows, "a1")).toHaveLength(2);
  });
});
