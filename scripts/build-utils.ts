import { existsSync } from "fs";
import { join } from "path";

/**
 * Shared logic to resolve the Nitro build output path.
 * Default is .output/public for TanStack Start / Nitro.
 */
export function getBuildOutputDir(): string {
  const envDir = process.env.NITRO_PUBLIC_DIR;
  if (envDir) return envDir;
  
  // Canonical default for TanStack Start + Nitro
  return join(process.cwd(), ".output", "public");
}

export function validateOutputDir(dir: string): void {
  if (!existsSync(dir)) {
    throw new Error(`Build output directory not found: ${dir}\nEnsure 'bun run build' finished successfully.`);
  }
}
