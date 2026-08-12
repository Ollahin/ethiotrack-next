# PWA Offline Shell Implementation Plan

Restore the last simple local security model: **Operations-managed Master PIN** and **User-managed Daily PIN**.

Implement an installable offline PWA shell for EthioTrack.

## 1. Local Font Hosting

Remove external font dependencies (Google Fonts) by downloading and hosting font files locally to ensure the UI renders correctly offline.

## 2. PWA Manifest & Head Updates

Enhance `public/manifest.webmanifest` and `src/routes/__root.tsx` with all required PWA meta tags and asset references.

## 3. Service Worker Enhancement

Extend `public/sw.js` to include:

- **Precaching**: Core application shell (HTML, CSS, JS, Manifest, Icons).
- **Navigation Fallback**: Serve `index.html` for all navigation requests when offline.
- **Cache Management**: Handle updates with a simple "Update available" UI.
- **Exclusion**: Ensure financial data (IndexedDB) and OCR artifacts are NEVER cached in Cache Storage.

## 4. Update UX

Implement a non-intrusive update notification in the `AppShell` that detects when a new service worker is waiting and prompts the user to reload.

## 5. Install UI

Add a guided install experience for Android (native prompt) and iOS (Add to Home Screen instructions) visible only when the app is not already installed.

## Technical Details

- **Fonts**: `DM Sans` and `IBM Plex Sans` will be downloaded and placed in `public/fonts/`.
- **SW Logic**:
  - `Stale-While-Revalidate` for assets.
  - `Network-First` for the manifest and root HTML to ensure updates.
  - `Cache-Only` fallback for offline navigation.
- **PWA Integrity**: Validating all asset paths and sizes.
- **Verification**: `bun run verify` and manual browser checks for offline persistence and navigation.

---

### Phase 1: Assets & Fonts

- [ ] Create `public/fonts/` directory.
- [ ] Download font files.
- [ ] Update `src/styles.css` to use local `@font-face`.

### Phase 2: Manifest & Head

- [ ] Update `public/manifest.webmanifest`.
- [ ] Update `src/routes/__root.tsx` head metadata.

### Phase 3: Service Worker

- [ ] Refactor `public/sw.js` for caching + share-target.
- [ ] Implement `src/lib/pwa-update.ts` for update detection.

### Phase 4: UI Components

- [ ] Create `src/components/InstallPrompt.tsx`.
- [ ] Create `src/components/UpdateNotification.tsx`.
- [ ] Integrate into `src/components/AppShell.tsx`.
