
import { plan--show } from "./plan--show";

/**
 * TASK 0.4C-c2R — Make offline PWA installation/update deterministic + restore CI
 * TASK 0.4C-bR7I — Repair unlock screen + lockout state machine
 */

# Phase 1: Repair Unlock Screen & Lockout State Machine
- **Cleanup UI**: Remove multi-line instruction leakage from `src/routes/unlock.tsx`.
- **Refactor Lockout**: Replace simple failure counter in `src/lib/crypto.ts` with a persistent state machine (failures, lockLevel, lockedUntil).
- **Independent Lockouts**: Ensure Daily PIN and Master PIN records are strictly separate in Dexie `meta`.

# Phase 2: Deterministic PWA & Asset Safety
- **Vite Integration**: Use `vite-plugin-pwa` (if possible) or a custom build script to generate a `sw-precache.js` containing real asset hashes.
- **Service Worker Refactor**: 
    - Remove handwritten `PRECACHE_ASSETS`.
    - Implement `SKIP_WAITING` message listener.
    - Restricted runtime cache (only scripts, styles, fonts, images).
    - Explicit bypass for POST/Share-target.
- **Head Meta**: Ensure `/index.html` dependency is handled via navigation fallback to the base path.

# Phase 3: Update Lifecycle UX
- **Update Logic**: Update `src/lib/pwa.ts` to show toast with "Update Now" button.
- **Skip Waiting**: Send message to worker on user click, then trigger `window.location.reload()`.

# Phase 4: CI & Verification
- **GitHub CI**: Fix any linting/type errors in `src/routes/reports.tsx` or components that broke the previous run (though `bun run verify` passed locally, user mentions CI failure).
- **Automated Tests**:
    - Add `src/lib/lockout.test.ts` for the new state machine.
    - Add `tests/pwa-integrity.test.ts` to verify build assets match SW precache.

# Technical Details
- **Lockout Storage**: `auth_lockout_v2` in Dexie `meta` store.
- **SW Pattern**: `Stale-While-Revalidate` for assets, `Network-First` (with fallback) for navigation.
- **Fonts**: Precached from `public/fonts/`.
