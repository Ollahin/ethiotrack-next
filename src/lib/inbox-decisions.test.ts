import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { addSmsInboxRows, clearAll, db, setInboxDecision, setInboxDecisions } from "./db";
import { ingestSmsDrafts } from "./capture/inbox-ingest";

const DRAFTS = ingestSmsDrafts("Credited with ETB 100.00\n\nCredited with ETB 200.00", {
  captureId: "cap",
  receivedAt: "2026-08-03T06:00:00.000Z",
});

describe("inbox review decisions survive a reload", () => {
  beforeEach(async () => {
    await clearAll();
    await addSmsInboxRows(DRAFTS);
  });

  it("stores a decision on the inbox row itself, not in screen state", async () => {
    await setInboxDecision("cap:0", { agentId: "a-1", purpose: "agent_settlement" });
    await setInboxDecision("cap:0", { day: "2026-08-03" });
    // A fresh read is exactly what a page refresh performs.
    const row = await db().sharedInputs.get("cap:0");
    expect(row?.decisions).toEqual({
      agentId: "a-1",
      purpose: "agent_settlement",
      day: "2026-08-03",
    });
  });

  it("keeps an explicit 'none' distinct from 'not decided yet'", async () => {
    await setInboxDecision("cap:0", { bankId: null });
    expect((await db().sharedInputs.get("cap:0"))?.decisions?.bankId).toBeNull();
    expect((await db().sharedInputs.get("cap:1"))?.decisions?.bankId).toBeUndefined();
  });

  it("applies a bulk date to every targeted row and leaves others untouched", async () => {
    expect(await setInboxDecisions(["cap:0", "cap:1"], { day: "2026-08-03" })).toBe(2);
    const rows = await db().sharedInputs.bulkGet(["cap:0", "cap:1"]);
    expect(rows.map((r) => r?.decisions?.day)).toEqual(["2026-08-03", "2026-08-03"]);
  });

  it("ignores unknown ids instead of creating orphan inbox rows", async () => {
    await setInboxDecision("missing", { day: "2026-08-03" });
    expect(await setInboxDecisions(["missing"], { day: "2026-08-03" })).toBe(0);
    expect(await db().sharedInputs.count()).toBe(DRAFTS.length);
  });
});
