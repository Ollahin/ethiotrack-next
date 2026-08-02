import { describe, expect, it } from "vitest";
import { ingestSmsDrafts, sortInboxRows, splitSmsMessages } from "./inbox-ingest";

const many = Array.from(
  { length: 200 },
  (_, i) =>
    `Dear Customer, ETB ${i + 1}.00 has been debited from your account 1000${i}. Ref FT${i}.`,
).join("\n\n");

describe("ingestSmsDrafts", () => {
  it("turns a 200-message paste into 200 ordered rows", () => {
    const drafts = ingestSmsDrafts(many, { captureId: "c1" });
    expect(drafts).toHaveLength(200);
    expect(drafts.map((d) => d.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(new Set(drafts.map((d) => d.id)).size).toBe(200);
    expect(drafts[0].id).toBe("c1:0");
    expect(drafts[199].text).toContain("FT199");
  });

  it("is idempotent for the same capture id, so a replayed share never doubles", () => {
    const a = ingestSmsDrafts(many, { captureId: "c1" }).map((d) => d.id);
    const b = ingestSmsDrafts(many, { captureId: "c1" }).map((d) => d.id);
    expect(a).toEqual(b);
  });

  it("keeps text with no money as one row instead of dropping it", () => {
    expect(splitSmsMessages("hello there")).toEqual(["hello there"]);
    expect(ingestSmsDrafts("   ")).toHaveLength(0);
  });

  it("records how the message arrived", () => {
    expect(ingestSmsDrafts("ETB 5.00 credited", { origin: "clipboard" })[0].origin).toBe(
      "clipboard",
    );
  });
});

describe("sortInboxRows", () => {
  it("orders oldest capture first and keeps source order inside a capture", () => {
    const rows = [
      { id: "b:1", receivedAt: "2026-08-02T10:00:00Z", seq: 1 },
      { id: "a:0", receivedAt: "2026-08-01T10:00:00Z", seq: 0 },
      { id: "b:0", receivedAt: "2026-08-02T10:00:00Z", seq: 0 },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["a:0", "b:0", "b:1"]);
  });
});
