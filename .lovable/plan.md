# EthioTrack Web — Plan

Rebuild the Android app as a fast, offline-first web app. All four tabs (Log, History, Agents, Leaks) plus Export. Data lives locally in IndexedDB — no login, no server, no data leaves the device.

## What gets built

**Log (home)**
- Header with EthioTrack wordmark + today's date + Export button.
- 4 dashboard tiles: Money In (today), Money Out (today), Airtime moved, Credit outstanding — color-coded, live totals.
- "New transaction" card: type (In / Out / Airtime / Credit), amount (ETB), counterparty/agent, channel (CBE, Telebirr, Awash, M-Pesa, Cash…), reference, note, date.
- "Paste bank alert" panel: paste one or many SMS/notification bodies → parser extracts amount, direction, party, ref, channel → shows a preview list → user confirms which to import. Rules-based parser covering common CBE, Telebirr, Awash, Dashen, Abyssinia formats; unrecognized lines flagged for manual entry.

**History**
- Full transaction list, newest first.
- Filters: date range, type, channel, agent, min/max amount, free-text search on party/ref/note.
- Row actions: edit, delete, duplicate. Running totals in the filter bar.

**Agents**
- Grouped by counterparty: total in / total out / net / open credit / txn count / last activity.
- Click an agent → filtered History for that agent.

**Leaks (anomaly detection)**
- Duplicates (same amount + party + channel within a short window).
- Unusually large outflows (> configurable multiple of your 30-day median out).
- Airtime spikes (> daily average × N).
- Aging open credits (outstanding > 30 days).
- Round-number "test" transactions right before large ones.
- Each finding: severity chip, one-line reason, links to the offending txn(s), "Ignore" and "Mark reviewed" actions.

**Export**
- CSV and JSON export of all data or the current filter.
- JSON import (for backup restore + moving between devices/browsers).
- "Clear all data" with confirm.

## Design direction

Keeps the source app's identity but modernized: dark ink navy header, paper off-white body, blue accent for primary actions, semantic colors for money in (green), out (red), airtime (amber), credit (violet). Mobile-first layout with bottom tab bar on small screens, side rail on desktop. Rounded cards, subtle shadows, generous spacing, tabular-nums for all amounts.

## Technical notes

- Stack: TanStack Start (already scaffolded) + Tailwind + shadcn.
- Routes: `/` (Log), `/history`, `/agents`, `/leaks`, `/export`. Root layout renders the header, bottom tab bar (mobile), and side nav (desktop).
- Storage: IndexedDB via `idb` (single `transactions` store + `settings` store for parser rules and ignored leaks). Zustand + `useLiveQuery`-style hook for reactive reads.
- Parser: pure module `src/lib/parser.ts` with an array of regex rules per channel; unit-testable, easy to extend.
- Anomaly engine: pure module `src/lib/leaks.ts` that takes the full txn list and returns findings; recomputed with `useMemo`.
- Validation with zod on every form and on parsed rows before import.
- Amounts stored as integers (cents / santim) to avoid float drift; formatted with `Intl.NumberFormat('am-ET')`.
- No backend, no auth, no network calls at runtime. Data never leaves the browser.

## Out of scope for v1

- Cloud sync / accounts (user chose local-only).
- Automatic notification capture (impossible on the web; paste-parser covers it).
- Multi-currency, budgets, recurring txns, charts beyond the 4 tiles — can come later.
