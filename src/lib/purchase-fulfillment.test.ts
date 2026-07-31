import { describe, expect, it } from "vitest";
import {
  buildFulfillmentQueue,
  buildPurchaseIntent,
  chargesSantim,
  elapsedSincePayment,
  expectedEvdSantim,
  exceptionNoteRequired,
  fulfilledSantim,
  isPurchaseIntent,
  makeAdjustmentEntry,
  makeExceptionEntry,
  makeReceiptEntry,
  matchDistributorForPayment,
  OVERDUE_AFTER_MS,
  validateException,
  validateReceipt,
} from "./purchase-fulfillment";
import type { Distributor, FulfillmentEntry, Transaction } from "./types";

const PAID_AT = "2025-08-11T09:00:00.000Z";
const PAID_MS = Date.parse(PAID_AT);

function dist(over: Partial<Distributor> = {}): Distributor {
  return {
    id: "d1",
    name: "MJ Trading",
    telecoms: ["ethiotelecom"],
    forms: ["evd"],
    createdAt: PAID_AT,
    ...over,
  };
}

function payment(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    type: "out",
    amountSantim: 101_500,
    partyName: "MJ Trading",
    channel: "CBE",
    source: "manual",
    date: PAID_AT,
    createdAt: PAID_AT,
    ...over,
  };
}

function entry(over: Partial<FulfillmentEntry> = {}): FulfillmentEntry {
  return {
    id: "e1",
    intentTxnId: "t1",
    kind: "receipt",
    amountSantim: 0,
    recordedAt: PAID_AT,
    ...over,
  };
}

function intentOf(t: Transaction, entries: FulfillmentEntry[] = [], now = PAID_MS) {
  return buildPurchaseIntent(t, dist(), entries, now);
}

describe("intent detection", () => {
  it("matches an exact normalized distributor name", () => {
    expect(
      matchDistributorForPayment(payment({ partyName: "  mj   TRADING " }), [dist()])?.id,
    ).toBe("d1");
  });

  it("matches a configured alias exactly, never fuzzily", () => {
    const d = dist({ aliases: ["MJ TRADING PLC"] });
    expect(
      matchDistributorForPayment(payment({ partyName: "mj trading plc" }), [d]),
    ).not.toBeNull();
    expect(matchDistributorForPayment(payment({ partyName: "MJ Tradng PLC" }), [d])).toBeNull();
  });

  it("matches a configured account tail found in the payment text", () => {
    const d = dist({ name: "Other", accountTails: ["4417"] });
    const t = payment({ partyName: "Transfer to 1000234417", note: undefined });
    expect(matchDistributorForPayment(t, [d])?.id).toBe("d1");
  });

  it("ignores unmatched, incoming and personal payments", () => {
    expect(isPurchaseIntent(payment({ partyName: "Random Shop" }), [dist()])).toBe(false);
    expect(isPurchaseIntent(payment({ type: "in" }), [dist()])).toBe(false);
    expect(isPurchaseIntent(payment({ isPersonal: true }), [dist()])).toBe(false);
  });

  it("keeps one intent per payment even when re-imported rows repeat", () => {
    const a = payment({ id: "t1" });
    const queue = buildFulfillmentQueue([a, a], [dist()], [], PAID_MS);
    expect(queue).toHaveLength(1);
  });
});

describe("money separation", () => {
  it("expects the principal, not the final debit", () => {
    const t = payment({ amountSantim: 101_500, principalSantim: 100_000 });
    expect(expectedEvdSantim(t)).toBe(100_000);
    expect(chargesSantim(t)).toBe(1_500);
    const intent = intentOf(t);
    expect(intent.expectedSantim).toBe(100_000);
    expect(intent.finalDebitSantim).toBe(101_500);
  });

  it("falls back to the debit when no principal is recorded", () => {
    expect(expectedEvdSantim(payment())).toBe(101_500);
    expect(chargesSantim(payment())).toBe(0);
  });
});

describe("partial fulfilment", () => {
  const t = payment({ principalSantim: 100_000 });

  it("tracks partial receipts and outstanding balance", () => {
    const intent = intentOf(t, [entry({ amountSantim: 40_000 })]);
    expect(intent.fulfilledSantim).toBe(40_000);
    expect(intent.outstandingSantim).toBe(60_000);
    expect(intent.partial).toBe(true);
    expect(intent.status).toBe("partially_fulfilled");
  });

  it("closes at exactly the expected total", () => {
    const intent = intentOf(t, [
      entry({ id: "e1", amountSantim: 40_000 }),
      entry({ id: "e2", amountSantim: 60_000 }),
    ]);
    expect(intent.outstandingSantim).toBe(0);
    expect(intent.status).toBe("fulfilled");
    expect(intent.surplusSantim).toBe(0);
  });
});

describe("surplus handling", () => {
  const intent = intentOf(payment({ principalSantim: 100_000 }));

  it("blocks an unclassified over-receipt", () => {
    const res = validateReceipt(intent, { amountSantim: 120_000 });
    expect(res.ok).toBe(false);
  });

  it("accepts an explicitly classified surplus", () => {
    const res = validateReceipt(intent, {
      amountSantim: 120_000,
      surplusClassification: "bonus",
    });
    expect(res).toEqual({ ok: true, surplusSantim: 20_000 });
    const e = makeReceiptEntry(
      intent,
      { amountSantim: 120_000, surplusClassification: "bonus" },
      20_000,
      "e9",
      PAID_AT,
    );
    expect(e.surplusSantim).toBe(20_000);
    expect(e.surplusClassification).toBe("bonus");
  });
});

describe("overdue boundaries", () => {
  const t = payment({ principalSantim: 100_000 });

  it("is pending at exactly 15 minutes and overdue just after", () => {
    expect(intentOf(t, [], PAID_MS + OVERDUE_AFTER_MS).status).toBe("pending");
    expect(intentOf(t, [], PAID_MS + OVERDUE_AFTER_MS + 1).status).toBe("overdue");
  });

  it("never fabricates a clock for date-only payments", () => {
    const dayOnly = payment({ date: "2025-08-11", dateIsDayOnly: true });
    expect(elapsedSincePayment(dayOnly, PAID_MS + 10 * 3_600_000)).toBeNull();
    const intent = buildPurchaseIntent(dayOnly, dist(), [], PAID_MS + 10 * 3_600_000);
    expect(intent.timeKnown).toBe(false);
    expect(intent.status).toBe("pending");
  });

  it("fulfilled payments are never overdue", () => {
    const intent = intentOf(t, [entry({ amountSantim: 100_000 })], PAID_MS + 86_400_000);
    expect(intent.status).toBe("fulfilled");
  });
});

describe("exceptions and corrections", () => {
  const t = payment({ principalSantim: 100_000 });

  it("requires a note for late exceptions only", () => {
    const fresh = intentOf(t, [], PAID_MS + 60_000);
    const late = intentOf(t, [], PAID_MS + 3_600_000);
    expect(exceptionNoteRequired(fresh, PAID_MS + 60_000)).toBe(false);
    expect(exceptionNoteRequired(late, PAID_MS + 3_600_000)).toBe(true);
    expect(validateException(late, "disputed", "", PAID_MS + 3_600_000).ok).toBe(false);
    expect(validateException(late, "disputed", "no EVD sent", PAID_MS + 3_600_000).ok).toBe(true);
  });

  it("disputed and cancelled override outstanding status", () => {
    const disputed = makeExceptionEntry(intentOf(t), "disputed", "n", "e1", PAID_AT);
    expect(intentOf(t, [disputed], PAID_MS + 86_400_000).status).toBe("disputed");
    const cancelled = makeExceptionEntry(intentOf(t), "cancelled", "refunded", "e2", PAID_AT);
    expect(intentOf(t, [cancelled], PAID_MS + 86_400_000).status).toBe("cancelled");
  });

  it("blocks receipts against a cancelled intent", () => {
    const cancelled = makeExceptionEntry(intentOf(t), "cancelled", "refunded", "e2", PAID_AT);
    const intent = intentOf(t, [cancelled]);
    expect(validateReceipt(intent, { amountSantim: 1_000 }).ok).toBe(false);
  });

  it("corrects by appending a signed adjustment, never rewriting", () => {
    const wrong = entry({ id: "e1", amountSantim: 60_000 });
    const fix = makeAdjustmentEntry(intentOf(t), -20_000, "typo", "e2", PAID_AT, "e1");
    const entries = [wrong, fix];
    expect(entries[0].amountSantim).toBe(60_000);
    expect(fulfilledSantim(entries)).toBe(40_000);
    expect(fix.correctsEntryId).toBe("e1");
  });

  it("marks personal payments personal and drops them from the active queue", () => {
    const personal = payment({ isPersonal: true });
    expect(buildFulfillmentQueue([personal], [dist()], [], PAID_MS)).toHaveLength(0);
    const kept = buildFulfillmentQueue([personal], [dist()], [], PAID_MS, {
      includePersonal: true,
    });
    expect(kept[0].status).toBe("personal");
  });
});

describe("persistence shape", () => {
  it("derives identical state from the same stored entries (refresh safe)", () => {
    const t = payment({ principalSantim: 100_000 });
    const stored = [entry({ id: "e1", amountSantim: 40_000 })];
    const first = buildFulfillmentQueue([t], [dist()], stored, PAID_MS);
    const afterRefresh = buildFulfillmentQueue([t], [dist()], stored, PAID_MS);
    expect(afterRefresh).toEqual(first);
    expect(afterRefresh[0].fulfilledSantim).toBe(40_000);
  });

  it("orders the queue newest payment first", () => {
    const older = payment({ id: "t1", date: "2025-08-10T09:00:00.000Z" });
    const newer = payment({ id: "t2", date: "2025-08-12T09:00:00.000Z" });
    expect(
      buildFulfillmentQueue([older, newer], [dist()], [], PAID_MS).map((i) => i.txnId),
    ).toEqual(["t2", "t1"]);
  });
});
