import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { getBuildOutputDir } from "./build-utils";
function checkCleanTree() {
  console.log("Checking clean-tree invariant...");
  try {
    execSync("git diff --exit-code");
    const status = execSync("git status --short").toString();
    if (status.trim().length > 0) {
      throw new Error("Untracked files present");
    }
  } catch (error) {
    console.error("ERROR: Build or tests modified the source tree!");
    console.log("\n--- git status ---");
    console.log(execSync("git status --short").toString());
    console.log("\n--- git diff ---");
    console.log(execSync("git diff").toString());
    process.exit(1);
  }
}
function checkPrecache() {
  const outputDir = getBuildOutputDir();
  const distPath = join(outputDir, "sw-precache.js");
  console.log(`Validating precache at ${distPath}...`);
  if (!existsSync(distPath)) {
    console.error(`ERROR: Missing build output at ${distPath}`);
    process.exit(1);
  }
  const content = readFileSync(distPath, "utf-8");
  if (!content.includes("self.PRECACHE_ASSETS =")) {
    console.error("ERROR: sw-precache.js does not contain valid asset list");
    process.exit(1);
  }
  // Parse assets to validate content
  const match = content.match(/self\.PRECACHE_ASSETS = (\[[\s\S]*?\]);/);
  if (!match) {
    console.error("ERROR: Could not parse PRECACHE_ASSETS from sw-precache.js");
    process.exit(1);
  }
  const assets = JSON.parse(match[1]);
  // 1. Assert root-relative URLs
  for (const asset of assets) {
    if (asset !== "/" && !asset.startsWith("/")) {
      console.error(`ERROR: Non-root-relative URL in precache: ${asset}`);
      process.exit(1);
    }
    // 2. Assert no /functions/ leakage
    if (asset.includes("/functions/") || asset.includes(".vercel/output/functions")) {
      console.error(`ERROR: Server function leaked into precache: ${asset}`);
      process.exit(1);
    }
    // 3. Verify file exists (skip root /)
    if (asset !== "/") {
      const filePath = join(outputDir, asset.substring(1));
      if (!existsSync(filePath)) {
        console.error(`ERROR: Precached file does not exist at ${filePath}`);
        process.exit(1);
      }
    }
  }
  // 4. Assert sw-precache.js is not listed recursively
  if (assets.includes("/sw-precache.js")) {
    console.error("ERROR: sw-precache.js is recursively listed in its own manifest");
    process.exit(1);
  }
  // Verify no precache artifact leaked into public/
  const leakedPath = join(process.cwd(), "public", "sw-precache.js");
  if (existsSync(leakedPath)) {
    console.error("ERROR: sw-precache.js leaked into public/ directory!");
    process.exit(1);
  }
  console.log(`sw-precache.js validated (${assets.length} assets).`);
}
const command = process.argv[2];
if (command === "clean-tree") {
  checkCleanTree();
} else if (command === "precache") {
  checkPrecache();
} else {
  console.error("Unknown command");
  process.exit(1);
}
