import { existsSync } from "fs";
import { join } from "path";
/**
 * Shared logic to resolve the Nitro build output path.
 * Default is .output/public for TanStack Start / Nitro.
 */
export function getBuildOutputDir() {
    const envDir = process.env.NITRO_PUBLIC_DIR;
    if (envDir)
        return envDir;
    // 1. Vercel Build Output API (Deployment root: .vercel/output)
    const vercelStatic = join(process.cwd(), ".vercel", "output", "static");
    if (existsSync(vercelStatic)) {
        return vercelStatic;
    }
    // 2. Nitro Default Output API (Standard Nitro build)
    const nitroOutput = join(process.cwd(), ".output", "public");
    if (existsSync(nitroOutput))
        return nitroOutput;
    // 3. Nitro 'vercel' preset fallback observed in local/CI environment
    const distClient = join(process.cwd(), "dist", "client");
    if (existsSync(distClient))
        return distClient;
    // Final fallback (fails in validateOutputDir if not found)
    return distClient;
}
export function validateOutputDir(dir) {
    if (!existsSync(dir)) {
        throw new Error(`Build output directory not found: ${dir}\nEnsure 'bun run build' finished successfully.`);
    }
}
