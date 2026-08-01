import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accountIsEmpty,
  BackupImportError,
  clearAll,
  db,
  exportBackup,
  importBackup,
  metaGet,
  metaSet,
} from "./db";
import { BACKUP_VERSION, countsOf, type BackupV4 } from "./backup-format";
import { distributorLedger, expectedStock } from "./distributor-ledger";
import type { Agent, Distributor, Transaction } from "./types";

const DIST_EVD: Distributor = {
  id: "d-evd",
  name: "Moderntech EVD",
  statementFormat: "modern-app",
  telecoms: ["ethiotelecom"],
  forms: ["evd"],
  createdAt: "2026-07-01T00:00:00.000Z",
};
const DIST_FLOAT: Distributor = {
  id: "d-float",
  name: "Moderntech Float",
  statementFormat: "modern-app",
  telecoms: ["safaricom"],
  forms: ["float"],
  createdAt: "2026-07-01T00:00:00.000Z",
};
const AGENT: Agent = { id: "a-1", name: "Agent One", createdAt: "2026-07-01T00:00:00.000Z" };

function airtime(over: Partial<Transaction> & { id: string; amountSantim: number }): Transaction {
  return {
    type: "airtime_evd",
    partyId: AGENT.id,
    partyType: "agent",
    partyName: AGENT.name,
    channel: "Moderntech",
    distributorId: DIST_EVD.id,
    telecom: "ethiotelecom",
    airtimeDirection: "sent",
    source: "screenshot_import",
    date: "2026-07-24T00:00:00.000Z",
    createdAt: "2026-07-24T00:00:00.000Z",
    ...over,
  } as Transaction;
}

/** EVD: 61,500 sent + 104,000 reversed. Float: 151,500 received, 20,200 sent. */
function baselineTransactions(): Transaction[] {
  return [
    airtime({
      id: "t-evd-sent",
      amountSantim: 6_150_000,
      dateIsDayOnly: true,
      reference: "MJ-0001",
    }),
    airtime({
      id: "t-evd-reversal",
      amountSantim: 10_400_000,
      isReversal: true,
      needsReview: true,
      overrideReason: "Reversal exceeds delivered balance — reviewer confirmed",
      reference: "MJ-0002",
    }),
    airtime({
      id: "t-float-received",
      type: "airtime_float",
      amountSantim: 15_150_000,
      airtimeDirection: "received",
      distributorId: DIST_FLOAT.id,
      telecom: "safaricom",
      partyId: DIST_FLOAT.id,
      partyType: "distributor",
      partyName: DIST_FLOAT.name,
      reference: "FL-0001",
    }),
    airtime({
      id: "t-float-sent",
      type: "airtime_float",
      amountSantim: 2_020_000,
      distributorId: DIST_FLOAT.id,
      telecom: "safaricom",
      reference: "FL-0002",
    }),
  ];
}

async function seedBaseline() {
  const d = db();
  await d.agents.bulkPut([AGENT]);
  await d.distributors.bulkPut([DIST_EVD, DIST_FLOAT]);
  await d.statementImports.bulkPut([
    {
      id: "imp-1",
      distributorId: DIST_EVD.id,
      fileName: "mj-sent.jpg",
      rowCount: 2,
      totalSantim: 16_550_000,
      importedAt: "2026-07-24T09:00:00.000Z",
      rawText: "24 Jul 2026  61,500.00",
      sourceKind: "image",
      status: "parsed",
      layout: "mj",
      orientation: 0,
    },
  ]);
  await d.transactions.bulkPut(
    baselineTransactions().map((t) => ({ ...t, statementImportId: "imp-1" })),
  );
  await metaSet("user_profile_v1", { name: "Owner", businessName: "Shop" });
  await metaSet("pin_v1", { hash: "secret", salt: "s" });
}

function ledgerTotals(txns: Transaction[], distributorId: string, form: "evd" | "float") {
  const m = distributorLedger(txns, distributorId)[form];
  return { ...m, stock: expectedStock(0, m) };
}

beforeEach(async () => {
  await clearAll();
  await db().meta.clear();
});

describe("backup round trip", () => {
  it("exports a versioned backup with matching counts and portable settings only", async () => {
    await seedBaseline();
    const b = await exportBackup();
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.app).toBe("ethiotrack");
    expect(b.counts).toEqual(countsOf(b));
    expect(b.counts.transactions).toBe(4);
    expect(b.settings.map((s) => s.key)).toEqual(["user_profile_v1"]);
  });

  it("restores identical financial state after a full account wipe", async () => {
    await seedBaseline();
    const before = await exportBackup();
    const beforeTxns = await db().transactions.toArray();
    const evdBefore = ledgerTotals(beforeTxns, DIST_EVD.id, "evd");
    const floatBefore = ledgerTotals(beforeTxns, DIST_FLOAT.id, "float");

    expect(evdBefore.sent).toBe(6_150_000);
    expect(evdBefore.reversed).toBe(10_400_000);
    expect(evdBefore.stock).toBe(4_250_000);
    expect(floatBefore.received).toBe(15_150_000);
    expect(floatBefore.sent).toBe(2_020_000);
    expect(floatBefore.stock).toBe(13_130_000);

    await clearAll();
    await db().meta.clear();
    expect(await accountIsEmpty()).toBe(true);

    await importBackup(JSON.parse(JSON.stringify(before)) as BackupV4);

    const after = await db().transactions.toArray();
    expect(after.length).toBe(4);
    expect(await db().agents.count()).toBe(1);
    expect(await db().distributors.count()).toBe(2);
    expect(await db().statementImports.count()).toBe(1);
    expect(ledgerTotals(after, DIST_EVD.id, "evd")).toMatchObject({
      sent: 6_150_000,
      reversed: 10_400_000,
      stock: 4_250_000,
    });
    expect(ledgerTotals(after, DIST_FLOAT.id, "float")).toMatchObject({
      received: 15_150_000,
      sent: 2_020_000,
      stock: 13_130_000,
    });

    const reversal = after.find((t) => t.id === "t-evd-reversal")!;
    expect(reversal.isReversal).toBe(true);
    expect(reversal.needsReview).toBe(true);
    expect(reversal.overrideReason).toContain("reviewer confirmed");
    expect(after.find((t) => t.id === "t-evd-sent")!.dateIsDayOnly).toBe(true);
    expect(after.map((t) => t.reference).sort()).toEqual([
      "FL-0001",
      "FL-0002",
      "MJ-0001",
      "MJ-0002",
    ]);
    expect(after.every((t) => t.statementImportId === "imp-1")).toBe(true);
    expect(await metaGet("user_profile_v1")).toMatchObject({ name: "Owner" });
  });

  it("keeps device credentials out of the file and out of the restore", async () => {
    await seedBaseline();
    const b = await exportBackup();
    expect(JSON.stringify(b)).not.toContain("pin_v1");
    await importBackup(b, { replaceExisting: true });
    expect(await metaGet("pin_v1")).toMatchObject({ hash: "secret" });
  });

  it("restores fulfillment records, including when there are none", async () => {
    await seedBaseline();
    await db().fulfillments.put({
      id: "f-1",
      intentTxnId: "t-evd-sent",
      kind: "receipt",
      amountSantim: 1_000_000,
      recordedAt: "2026-07-25T00:00:00.000Z",
    });
    const b = await exportBackup();
    await clearAll();
    await importBackup(b);
    expect(await db().fulfillments.count()).toBe(1);

    await clearAll();
    const empty = await exportBackup();
    expect(empty.fulfillments).toEqual([]);
    await importBackup(empty);
    expect(await db().fulfillments.count()).toBe(0);
  });

  it("requires explicit replacement confirmation for a non-empty account", async () => {
    await seedBaseline();
    const b = await exportBackup();
    await expect(importBackup(b)).rejects.toBeInstanceOf(BackupImportError);
    expect(await db().transactions.count()).toBe(4);
    await importBackup(b, { replaceExisting: true });
    expect(await db().transactions.count()).toBe(4);
  });

  it("replaces rather than merges — no duplicated financial history", async () => {
    await seedBaseline();
    const b = await exportBackup();
    await importBackup(b, { replaceExisting: true });
    await importBackup(b, { replaceExisting: true });
    expect(await db().transactions.count()).toBe(4);
  });

  it("rejects a corrupt backup and leaves the account untouched (atomic failure)", async () => {
    await seedBaseline();
    const good = await exportBackup();
    const corrupt = JSON.parse(JSON.stringify(good)) as BackupV4;
    corrupt.transactions[0].distributorId = "does-not-exist";

    await expect(importBackup(corrupt, { replaceExisting: true })).rejects.toBeInstanceOf(
      BackupImportError,
    );
    const after = await db().transactions.toArray();
    expect(after.length).toBe(4);
    expect(after.find((t) => t.id === "t-evd-sent")!.distributorId).toBe(DIST_EVD.id);
    expect(await db().agents.count()).toBe(1);
  });

  it("rejects duplicate ids inside the file before writing anything", async () => {
    await seedBaseline();
    const b = await exportBackup();
    const dupe = JSON.parse(JSON.stringify(b)) as BackupV4;
    dupe.transactions.push({ ...dupe.transactions[0] });
    dupe.counts = countsOf(dupe);
    await expect(importBackup(dupe, { replaceExisting: true })).rejects.toThrow(/duplicate id/);
    expect(await db().transactions.count()).toBe(4);
  });
});
