
## Goal
Adopt the uploaded BankPick UI kit as EthioTrack's visual system: dark navy canvas, glossy indigo "card" hero, bright blue accent, circular quick-action buttons, soft dividers, IBM Plex / DM Sans typography. Mobile-first, but scales up to the existing desktop rail.

No feature changes — same routes, same data model, same weekly cycle. Only presentation.

## Design tokens (src/styles.css)
Replace the current paper/blue tokens with a dark-first palette, default `.dark` class on `<html>`:
- `--background` `#0B1120` (deep navy, avoid pure black)
- `--card` `#141B2D` with subtle border `#1F2A44`
- `--foreground` `#F8FAFC`, `--muted-foreground` `#8A94A6`
- `--primary` `#3B82F6` (BankPick blue), `--primary-foreground` `#FFFFFF`
- Domain colors kept but tuned for dark: `money-in` `#22C55E`, `money-out` `#F87171`, `airtime` `#F59E0B`, `credit` `#A78BFA`
- New gradient token `--gradient-hero`: linear-gradient(135deg, #1E3A8A → #3B82F6) + faint radial highlight, used on the dashboard hero card
- Fonts loaded via `<link>` in `__root.tsx`: `IBM Plex Sans` (600/700 headings) + `DM Sans` (400/500 body). Tabular numerals for money.

## Layout & components
1. **AppShell**
   - Mobile: replace grey tab bar with a floating dark bar (`bg-card/90 backdrop-blur`, rounded-2xl, 5 icons, active pill is blue circle behind icon), keep same 5 tabs.
   - Desktop: keep left rail but restyle — dark card, blue active pill instead of solid bar, softer separators.
   - Top bar (mobile): avatar/initials on left, greeting + week label, search-style icon button on right.

2. **Dashboard hero (routes/index.tsx)**
   - New `WeekHeroCard`: glossy gradient block with faint map/dot texture (SVG overlay), showing "Current week balance" (net cash position) big, plus week range and Open/Close status pill. Mirrors the BankPick card.
   - Circular quick actions row underneath: `Capture / Agents / Alerts / Reports` as 56px circles with icon + label below (replaces existing quick-action grid).
   - `DashboardTiles` restyled: 2×2 grid of dark cards with coloured accent dot + label + big tabular number, drop the top accent bar for a left 3px coloured stripe.

3. **Lists (History, Agents, Alerts)**
   - Row style from BankPick "Transaction" list: circular icon badge (channel-coloured) + title/subtitle stack + right-aligned signed amount in domain colour. Divider = 1px `border/40`. Sticky section headers "Today / Yesterday / <date>".

4. **Forms (Capture, TransactionForm, OpenPeriodModal)**
   - Inputs: `bg-muted`, no visible border until focus (then blue ring), rounded-xl, 48px height, floating label pattern using existing `<Label>`.
   - Primary buttons: full-width, rounded-xl, `bg-primary`, subtle glow shadow (`0 10px 30px -12px #3B82F6`).
   - Secondary: `bg-card` border.

5. **Settings** — grouped list rows with dividers + chevrons, section labels in muted uppercase, matching BankPick Settings screen.

6. **Reconcile / Close / Reports** — reuse the same card + list primitives; Close-week adds a large "Expected vs Actual" comparison block styled like the hero card (smaller).

## Motion
Respect `prefers-reduced-motion`. Add lightweight, no-new-deps CSS transitions only:
- Route content: `opacity 0 → 1`, translate-y 8px→0, 250ms ease-out on mount.
- Tile numbers: fade+rise 200ms when value changes (key by value).
- Buttons: scale 0.97 on active, 150ms.
No GSAP added — matches "Standard" motion tier via CSS keeps the bundle lean.

## Scope
Files touched (styling/markup only, no logic):
- `src/styles.css` — palette, fonts, gradient tokens, base body dark
- `src/routes/__root.tsx` — add `class="dark"` on html, font links
- `src/components/AppShell.tsx` — new nav treatment
- `src/components/DashboardTiles.tsx` — restyle
- `src/components/OpenPeriodModal.tsx`, `src/components/TransactionForm.tsx`, `src/components/PasteImport.tsx`, `src/components/PdfImport.tsx` — input/button polish
- `src/routes/index.tsx` — hero card + circular quick actions
- `src/routes/history.tsx`, `agents.tsx`, `alerts.tsx`, `distributors.tsx`, `banks.tsx`, `reconcile.tsx`, `close.tsx`, `reports.tsx`, `settings.tsx`, `unlock.tsx` — swap to new card/list primitives
- New: `src/components/ui/HeroCard.tsx`, `src/components/ui/ListRow.tsx`, `src/components/ui/CircleAction.tsx` (small shared primitives)

## Out of scope
- Data model, routes, business logic, PDF generator contents
- New icons beyond lucide-react
- Light-mode variant (dark-primary only; can be added later)

## Verification
Typecheck + build; visually spot-check dashboard, history, capture, settings against BankPick reference screens with Playwright screenshots at 375px and 1280px.
