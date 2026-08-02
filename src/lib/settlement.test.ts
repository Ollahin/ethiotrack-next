import { describe, expect, it } from "vitest";
import { agentLedger } from "./agent-ledger";
import { agentCredits, agentOutstanding, outstandingOf, planAllocations } from "./settlement";
import type { SettlementAllocation, Transaction } from "./types";

function credit(id: string, amountSantim: number, date: string): Transaction {
  return {
    id,
    type: "airtime_evd",
    amountSantim,
    partyId: "alexo",
    partyType: "agent",
    partyName: "Alexo",
    channel: "EVD",
    airtimeDirection: "sent",
    date,
    createdAt: date,
    source: "manual",
  } as Transaction;
}

function alloc(
  creditTxnId: string,
  amountSantim: number,
  paymentTxnId = "p1",
): SettlementAllocation {
  return {
    id: `${paymentTxnId}-${creditTxnId}`,
    paymentTxnId,
    creditTxnId,
    agentId: "alexo",
    amountSantim,
    createdAt: "2026-02-02T00:00:00.000Z",
  };
}

describe("planAllocations", () => {
  it("allocates a part payment against the oldest credit instead of doing nothing", () => {
    const credits = [credit("c1", 50_000_00, "2026-02-01T00:00:00.000Z")];
    const plan = planAllocations(15_000_00, credits);
    expect(plan.allocations).toEqual([
      { creditTxnId: "c1", amountSantim: 15_000_00, closes: false },
    ]);
    expect(plan.leftoverSantim).toBe(0);
    expect(
      outstandingOf(
        credits[0],
        plan.allocations.map((a) => alloc(a.creditTxnId, a.amountSantim)),
      ),
    ).toBe(35_000_00);
  });

  it("walks credits oldest first and closes only the ones fully covered", () => {
    const credits = [
      credit("c1", 10_000_00, "2026-02-01T00:00:00.000Z"),
      credit("c2", 20_000_00, "2026-02-02T00:00:00.000Z"),
    ];
    const plan = planAllocations(15_000_00, credits);
    expect(plan.allocations).toEqual([
      { creditTxnId: "c1", amountSantim: 10_000_00, closes: true },
      { creditTxnId: "c2", amountSantim: 5_000_00, closes: false },
    ]);
  });

  it("never allocates beyond what is owed and reports the leftover", () => {
    const credits = [credit("c1", 10_000_00, "2026-02-01T00:00:00.000Z")];
    const plan = planAllocations(12_000_00, credits);
    expect(plan.allocations).toEqual([
      { creditTxnId: "c1", amountSantim: 10_000_00, closes: true },
    ]);
    expect(plan.leftoverSantim).toBe(2_000_00);
  });

  it("respects allocations already recorded, so a replayed plan adds nothing", () => {
    const credits = [credit("c1", 50_000_00, "2026-02-01T00:00:00.000Z")];
    const existing = [alloc("c1", 50_000_00)];
    expect(planAllocations(15_000_00, credits, existing).allocations).toEqual([]);
  });

  it("only counts airtime sent to the agent as a credit", () => {
    const received = {
      ...credit("r", 9_000_00, "2026-02-01T00:00:00.000Z"),
      airtimeDirection: "received" as const,
    };
    expect(agentCredits("alexo", [received])).toEqual([]);
  });
});

describe("agent outstanding balance", () => {
  it("reports 35,000 outstanding after a 15,000 payment on a 50,000 credit", () => {
    const credits = [credit("c1", 50_000_00, "2026-02-01T00:00:00.000Z")];
    const allocations = [alloc("c1", 15_000_00)];
    expect(agentOutstanding("alexo", credits, allocations)).toEqual({
      openCredit: 35_000_00,
      unsettledCount: 1,
    });
    const led = agentLedger(credits, "alexo", undefined, allocations);
    expect(led.openCredit).toBe(35_000_00);
    expect(led.unsettledCount).toBe(1);
  });

  it("drops a credit out of the receivable once allocations cover it fully", () => {
    const credits = [credit("c1", 50_000_00, "2026-02-01T00:00:00.000Z")];
    const allocations = [alloc("c1", 15_000_00), alloc("c1", 35_000_00, "p2")];
    expect(agentOutstanding("alexo", credits, allocations)).toEqual({
      openCredit: 0,
      unsettledCount: 0,
    });
  });
});
