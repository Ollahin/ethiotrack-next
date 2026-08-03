import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addSmsInboxRows,
  addTransactions,
  clearAll,
  db,
  importInboxSms,
  setInboxDecisions,
} from "./db";
import { ingestSmsDrafts } from "./capture/inbox-ingest";
import { agentOutstanding } from "./settlement";
import { planBulkDate, storageIso } from "./capture/date";
import type { Transaction } from "./types";

const AGENT = "agent-alexo";

async function openCredit(): Promise<void> {
  await addTransactions([
    {
      type: "airtime_evd",
      amountSantim: 5_000_000,
      airtimeDirection: "sent",
      partyName: "Alexo",
      partyId: AGENT,
      partyType: "agent",
      channel: "Other",
      note: "EVD sent to Alexo",
      date: storageIso("2026-08-01"),
      dateIsDayOnly: true,
      source: "manual",
    } as Omit<Transaction, "id" | "createdAt">,
  ]);
}

const settlement: Omit<Transaction, "id" | "createdAt"> = {
  type: "in",
  amountSantim: 1_500_000,
  partyName: "Alexo",
  partyId: AGENT,
  partyType: "agent",
  channel: "CBE",
  note: "Credited with ETB 15,000.00",
  date: storageIso("2026-08-02"),
  dateIsDayOnly: true,
  captureKey: "ref:cbe|ft2608021",
  source: "paste_parse",
};

describe("agent settlement imported from the inbox", () => {
  beforeEach(async () => {
    await clearAll();
    await openCredit();
    await addSmsInboxRows(
      ingestSmsDrafts("Credited with ETB 15,000.00", { captureId: "cap" }),
    );
  });

  it("allocates partially against the open credit and clears the inbox row", async () => {
    const before = agentOutstanding(
      AGENT,
      await db().transactions.toArray(),
      await db().settlementAllocations.toArray(),
    );
    expect(before.openCredit).toBe(5_000_000);

    const res = await importInboxSms(settlement, { inboxId: "cap:0", settleAgentId: AGENT });
    expect(res.duplicate).toBe(false);
    expect(res.allocated).toBe(1_500_000);
    expect(res.closed).toBe(0);

    const after = agentOutstanding(
      AGENT,
      await db().transactions.toArray(),
      await db().settlementAllocations.toArray(),
    );
    expect(after.openCredit).toBe(3_500_000);
    expect(await db().sharedInputs.get("cap:0")).toBeUndefined();
    expect(await db().settlementAllocations.count()).toBe(1);
  });

  it("is idempotent: a retry writes no second receipt and no second allocation", async () => {
    await importInboxSms(settlement, { inboxId: "cap:0", settleAgentId: AGENT });
    const retry = await importInboxSms(settlement, { inboxId: "cap:0", settleAgentId: AGENT });
    expect(retry.duplicate).toBe(true);
    expect(await db().transactions.where("captureKey").equals("ref:cbe|ft2608021").count()).toBe(1);
    expect(await db().settlementAllocations.count()).toBe(1);
    const after = agentOutstanding(
      AGENT,
      await db().transactions.toArray(),
      await db().settlementAllocations.toArray(),
    );
    expect(after.openCredit).toBe(3_500_000);
  });
});

describe("bulk date safety", () => {
  beforeEach(async () => {
    await clearAll();
    await addSmsInboxRows(
      ingestSmsDrafts("Credited with ETB 100.00\n\nCredited with ETB 200.00", { captureId: "b" }),
    );
  });

  it("writes the day only to rows with no genuine date of their own", async () => {
    const plan = planBulkDate([
      { id: "b:0", hasGenuineDate: true },
      { id: "b:1", hasGenuineDate: false },
    ]);
    expect(plan).toEqual({ apply: ["b:1"], skipped: ["b:0"] });

    await setInboxDecisions(plan.apply, { day: "2026-08-03" });
    expect((await db().sharedInputs.get("b:0"))?.decisions?.day).toBeUndefined();
    // The applied day survives a fresh read, exactly as a refresh performs it.
    expect((await db().sharedInputs.get("b:1"))?.decisions?.day).toBe("2026-08-03");
  });
});
