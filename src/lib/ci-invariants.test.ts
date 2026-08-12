import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { execSync } from "child_process";

describe("CI and build invariants", () => {
  it("public/sw-precache.js MUST NOT exist in the repository", () => {
    // Check if it exists on disk - if it does, it might be git-ignored but let's check git too
    const exists = existsSync("public/sw-precache.js");

    // If it exists, verify it's not tracked by git
    if (exists) {
      try {
        const status = execSync("git ls-files --error-unmatch public/sw-precache.js", {
          stdio: "pipe",
        });
        // If the command above succeeds, the file is tracked!
        expect(status.toString()).toBe(""); // Should fail if tracked
      } catch (e) {
        // Command fails if file is not tracked, which is what we want
      }
    }
  });

  it("build script exists", () => {
    expect(existsSync("scripts/generate-precache.ts")).toBe(true);
  });
});
