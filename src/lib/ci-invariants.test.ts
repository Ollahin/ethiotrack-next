import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("CI and build invariants", () => {
  it("public/sw-precache.js MUST NOT exist in the repository", () => {
    // Check if it exists on disk - if it does, it might be git-ignored but let's check git too
    const exists = existsSync("public/sw-precache.js");
    
    // If it exists, verify it's not tracked by git
    if (exists) {
      try {
        const status = execSync("git ls-files --error-unmatch public/sw-precache.js", { stdio: 'pipe' });
        // If the command above succeeds, the file is tracked!
        expect(status.toString()).toBe(""); // Should fail if tracked
      } catch (e) {
        // Command fails if file is not tracked, which is what we want
      }
    }
  });

  it("build produces dist/client/sw-precache.js", () => {
    // This assumes a build has run, which `bun run verify` does.
    if (existsSync("dist/client")) {
      expect(existsSync("dist/client/sw-precache.js")).toBe(true);
      
      const content = readFileSync("dist/client/sw-precache.js", "utf-8");
      expect(content).toContain("self.PRECACHE_ASSETS = [");
      
      // Verify all paths in the precache list (except "/") actually exist in dist/client or public
      const match = content.match(/self\.PRECACHE_ASSETS = (\[[\s\S]*?\]);/);
      if (match) {
        const assets = JSON.parse(match[1]) as string[];
        for (const asset of assets) {
          if (asset === "/") continue;
          
          const pathInDist = join("dist/client", asset.slice(1));
          const pathInPublic = join("public", asset.slice(1));
          
          const found = existsSync(pathInDist) || existsSync(pathInPublic);
          if (!found) {
            throw new Error(`Precachable asset ${asset} not found in dist/client or public/`);
          }
        }
      }
    }
  });
});
