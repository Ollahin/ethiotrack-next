import { existsSync } from "fs";
import { join } from "path";

/**
 * Shared logic to resolve the Nitro build output path.
 * Default is .output/public for TanStack Start / Nitro.
 */
export function getBuildOutputDir(): string {
  const envDir = process.env.NITRO_PUBLIC_DIR;
  if (envDir) return envDir;
  
  // Nitro build creates .output/public
  const nitroOutput = join(process.cwd(), ".output", "public");
  if (existsSync(nitroOutput)) return nitroOutput;

  // Fallback for local Vite builds or intermediate steps
  return join(process.cwd(), "dist", "client");
}

export function validateOutputDir(dir: string): void {
  if (!existsSync(dir)) {
    throw new Error(`Build output directory not found: ${dir}\nEnsure 'bun run build' finished successfully.`);
  }
}
