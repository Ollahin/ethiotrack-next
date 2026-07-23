
# EthioTrack v2 — Rebuild Plan

Rewriting the web app around the blueprint's entity model, three ingestion pipelines, and the "Local Brain". Local-only, IndexedDB-encrypted, no cloud.

## Scope

### 1. Foundation (replaces current flat txn model)
- Swap `idb` for **Dexie.js**. New schema:
  - `agents(id, name, phone, credit_limit, avg_payment_days, created_at)`
  - `distributors(id, name, contact, statement_format, created_at)`
  - `banks(id, name, account_number, channel, balance)`
  - `daily_openings(id, date, cash_on_hand, bank_balances, evd_stock, float_stock, opened_at)`
  - `daily_closings(id, date, opening_id, actual_cash, variance, notes, closed_at)`
  - `transactions(id, type, amount, party_id, party_type, channel, reference, note, is_personal, is_settled, settled_at, source, statement_import_id, date, created_at)`
  - `statement_imports(id, distributor_id, file_name, row_count, imported_at, raw_text)`
  - `meta` (settings, PIN hash, encryption salt)
- Transaction types: `in | out | airtime_evd | airtime_float | expense | personal`.
- Sources: `manual | paste_parse | sms_listener | pdf_import | csv_import`.
- Amounts stored as integer santim.

### 2. Local auth + encryption
- Local PIN/password screen on first launch. Argon2/PBKDF2 (Web Crypto) derives a key from the PIN + a stored salt.
- Auto-lock after inactivity; unlock re-derives key. Encryption applied to sensitive text fields (party names, notes, refs) via AES-GCM helper. Master-data tables stay queryable (indexed fields left plain; free-text encrypted).
- Warning on setup: "Lose the PIN → data is unrecoverable."

### 3. Three ingestion pipelines
- **A. SMS Paste Parser** — keep + enhance current `parser.ts`. After parse, run fuzzy match (`fast-levenshtein`, ≥80%) against `agents`. If matched agent has open credits, prompt to apply FIFO settlement.
- **B. PDF Statement Import** — new drag-and-drop zone. Uses `pdfjs-dist` client-side. Per-distributor `DistributorStatementParser` (starts with a generic tabular extractor + one Ethio Telecom EVD rule; pluggable). Creates unsettled `airtime_evd`/`airtime_float` credits, auto-links agents, flags unlinked rows for manual review. Import summary card.
- **C. Manual entry** — form with entity dropdowns (agent/distributor/bank).
- (D. Android SMS listener — out of scope for web; noted for later Capacitor shell.)

### 4. Pages
- `/unlock` — PIN screen (gate for everything else).
- `/` Dashboard — Open-Day modal if today not opened; KPIs: Today's Sales, Today's Receipts, Open Credits total, Cash Variance.
- `/capture` — side-by-side Paste Parser + PDF Import Zone.
- `/agents` — Agent Book: card per agent with airtime received, payments, open credit balance (red if over limit), unsettled count, "avg payment delay X days". Click → agent ledger + Settle Credit.
- `/distributors`, `/banks` — master-data CRUD.
- `/history` — transactions with filters (type, party, channel, date, personal toggle).
- `/reconcile` — bank reconciliation (per-account running balance, auto-match incoming transfers to agent payments).
- `/close` — Daily Close: expected vs actual cash, variance explanation required, closes day.
- `/reports` — weekly PDF export (jsPDF): airtime distributed by type, cash collected, net P/L, aged receivables.
- `/alerts` — Brain alerts: overdue risk, distribution anomalies (>3σ), missing statement imports.
- `/settings` — export/import JSON backup, change PIN, clear all data.

### 5. Local Brain modules
- `src/lib/brain/fuzzy.ts` — Levenshtein name/phone resolver.
- `src/lib/brain/credits.ts` — FIFO settlement engine.
- `src/lib/brain/stats.ts` — per-agent avg payment days + stddev, anomaly detection.
- `src/lib/brain/alerts.ts` — generates the alerts feed from live data.

## Technical notes

- Packages to add: `dexie`, `dexie-react-hooks`, `fast-levenshtein`, `pdfjs-dist`, `jspdf`, `date-fns`.
- pdf.js worker: use the ESM `pdfjs-dist/build/pdf.worker.min.mjs` served as a static import so it stays in-browser.
- Existing flat `transactions` store from v1 will be migrated on first launch: infer `party_type='agent'` when possible, else keep as unlinked.
- All routes are gated behind `/unlock` via a `_authenticated`-style layout (`_locked.tsx`).
- Kept from v1: parser rules array, ETB formatting helpers, dashboard tile design language, dark-ink / paper aesthetic, mobile bottom-nav.
- Out of scope: cloud sync, multi-user, Android shell, real-time OCR.

## Build order

1. Dexie schema + PIN/encryption + `/unlock` gate + v1 migration.
2. Master data pages (agents, distributors, banks).
3. Day-open modal + dashboard KPIs.
4. Paste Parser v2 with fuzzy + FIFO settlement prompt.
5. PDF Import pipeline + statement_imports audit.
6. Agent Book + agent ledger + settle credit.
7. Bank reconciliation + Daily Close.
8. Brain alerts + weekly PDF report.
