import { describe, expect, it } from "vitest";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  base64ToBytes,
  bytesToBase64,
  checkIntegrity,
  countsOf,
  parseBackupText,
  validateBackup,
  type BackupV4,
} from "./backup-format";
import type { Transaction } from "./types";

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    type: "airtime_evd",
    amountSantim: 6_150_000,
    partyName: "Agent One",
    channel: "Moderntech",
    source: "screenshot_import",
    date: "2026-07-24T00:00:00.000Z",
    createdAt: "2026-07-24T00:00:00.000Z",
    ...over,
  };
}

function backup(over: Partial<Omit<BackupV4, "counts">> = {}): BackupV4 {
  const body: Omit<BackupV4, "counts"> = {
    app: BACKUP_APP,
    version: 5,
    exportedAt: "2026-08-01T00:00:00.000Z",
    settings: [],
    agents: [],
    distributors: [],
    banks: [],
    dailyOpenings: [],
    dailyClosings: [],
    periodOpenings: [],
    periodClosings: [],
    transactions: [],
    statementImports: [],
    fulfillments: [],
    approvedMappings: [],
    sharedInputs: [],
    ...over,
  };
  return { ...body, counts: countsOf(body) };
}

describe("backup format", () => {
  it("exposes a versioned format", () => {
    expect(BACKUP_VERSION).toBe(5);
  });

  it("accepts a well-formed empty backup", () => {
    const r = validateBackup(backup());
    expect(r.ok).toBe(true);
  });

  it("preserves reversal, override, principal and day-only fields through JSON", () => {
    const t = txn({
      isReversal: true,
      overrideReason: "Reviewer confirmed reversal exceeds delivered balance",
      principalSantim: 2_000_000,
      dateIsDayOnly: true,
      airtimeDirection: "sent",
      needsReview: true,
      reference: "REF-001",
    });
    const r = parseBackupText(JSON.stringify(backup({ transactions: [t] })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.transactions[0]).toMatchObject({
      isReversal: true,
      overrideReason: "Reviewer confirmed reversal exceeds delivered balance",
      principalSantim: 2_000_000,
      dateIsDayOnly: true,
      needsReview: true,
      reference: "REF-001",
    });
  });

  it("rejects non-JSON text", () => {
    const r = parseBackupText("not json {");
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors[0]).toContain("valid JSON");
  });

  it("rejects a file with no version", () => {
    const r = validateBackup({ agents: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects an unsupported future version with a useful explanation", () => {
    const r = validateBackup({ ...backup(), version: 99 });
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors[0]).toContain("version 99 is not supported");
  });

  it("rejects a malformed transaction row", () => {
    const bad = backup({ transactions: [txn()] });
    (bad.transactions[0] as unknown as { amountSantim: unknown }).amountSantim = "6150000";
    const r = validateBackup(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects tampered counts", () => {
    const b = backup({ transactions: [txn()] });
    b.counts.transactions = 5;
    const r = validateBackup(b);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain("counts.transactions");
  });

  it("detects duplicate ids", () => {
    const b = backup({ transactions: [txn(), txn()] });
    expect(checkIntegrity(b).join(" ")).toContain("duplicate id");
  });

  it("detects a dangling distributor reference", () => {
    const b = backup({ transactions: [txn({ distributorId: "missing" })] });
    expect(checkIntegrity(b).join(" ")).toContain("distributorId missing");
  });

  it("detects a dangling fulfillment intent", () => {
    const b = backup({
      fulfillments: [
        {
          id: "f1",
          intentTxnId: "nope",
          kind: "receipt",
          amountSantim: 100,
          recordedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(checkIntegrity(b).join(" ")).toContain("intentTxnId nope");
  });

  it("detects a dangling settlement link", () => {
    const b = backup({ transactions: [txn({ settlesTxnIds: ["ghost"] })] });
    expect(checkIntegrity(b).join(" ")).toContain("missing transaction ghost");
  });

  it("refuses credential settings inside a backup file", () => {
    const b = backup({ settings: [{ key: "daily_pin_v1", value: { hash: "x" } }] });
    expect(checkIntegrity(b).join(" ")).toContain("not portable");
  });

  it("migrates a supported legacy v2 backup", () => {
    const legacy = {
      version: 2,
      exportedAt: "2026-01-01T00:00:00.000Z",
      agents: [],
      distributors: [],
      banks: [],
      dailyOpenings: [],
      dailyClosings: [],
      transactions: [txn()],
      statementImports: [],
    };
    const r = validateBackup(legacy);
    expect(r).toMatchObject({ ok: true, migratedFromVersion: 2 });
    if (!r.ok) return;
    expect(r.backup.version).toBe(5);
    expect(r.backup.counts.transactions).toBe(1);
    expect(r.backup.settings).toEqual([]);
    expect(r.backup.approvedMappings).toEqual([]);
  });

  it("round-trips binary screenshot evidence through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 137]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
