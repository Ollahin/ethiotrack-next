import { describe, expect, it } from "vitest";
import { draftsFromHandoff, pendingCount } from "./share-inbox";
import type { SharedInput } from "./types";

const base = { id: "h1", receivedAt: "2026-01-05T08:00:00.000Z" };

describe("draftsFromHandoff", () => {
  it("makes one draft per shared file, keyed stably off the handoff id", () => {
    const drafts = draftsFromHandoff({
      ...base,
      files: [
        { name: "shot.png", type: "image/png", blob: new Blob(["x"]) },
        { name: "statement.pdf", type: "application/pdf", blob: new Blob(["y"]) },
      ],
    });
    expect(drafts.map((d) => d.id)).toEqual(["h1:f0", "h1:f1"]);
    expect(drafts.map((d) => d.kind)).toEqual(["image", "pdf"]);
  });

  it("keeps text alongside files instead of dropping either", () => {
    const drafts = draftsFromHandoff({
      ...base,
      text: "Dear Customer, ETB 500.00 debited",
      files: [{ name: "shot.png", type: "image/png", blob: new Blob(["x"]) }],
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({ id: "h1:t", kind: "text" });
  });

  it("never silently swallows an empty share", () => {
    const drafts = draftsFromHandoff({ ...base, text: "   " });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("unsupported");
    expect(drafts[0].error).toBeTruthy();
  });

  it("marks a file type it cannot read as unsupported rather than guessing", () => {
    const drafts = draftsFromHandoff({
      ...base,
      files: [{ name: "clip.mp4", type: "video/mp4", blob: new Blob(["x"]) }],
    });
    expect(drafts[0].kind).toBe("unsupported");
  });
});

describe("pendingCount", () => {
  it("counts only items still awaiting review", () => {
    const items = [
      { status: "pending" },
      { status: "reviewed" },
      { status: "dismissed" },
      { status: "pending" },
    ] as SharedInput[];
    expect(pendingCount(items)).toBe(2);
  });
});
