## Goal
Make the weekly opening modal show, for each cash / bank / distributor field, the exact expected carry-forward value alongside what the user entered, and highlight any field that doesn't match.

## What "expected" means
The expected opening for a new week = the previous week's opening + all business (non-personal) transactions dated in that previous week, computed per account:
- Cash: prev cash + `in` (no bank) − (`out` + `expense`) (no bank)
- Each bank/wallet: prev balance + `in` on that bank − (`out` + `expense`) on that bank
- Each distributor EVD: prev EVD stock − `airtime_evd` issued for that distributor
- Each distributor Float: prev Float stock − `airtime_float` issued for that distributor

If there is no prior weekly opening, no expected values are shown (first-ever week).

## Changes

### 1. `src/lib/db.ts` — new reactive hook
Add `usePreviousPeriodExpected(weekStart)` that:
- Finds the most recent `PeriodOpening` with `weekStart < current weekStart`.
- Loads transactions dated `[prevWeekStart, weekStart)`.
- Returns `{ prevWeekStart, cashSantim, bankBalances, evdStockByDistributor, floatStockByDistributor }`, or `null` when no prior opening exists.

### 2. `src/components/OpenPeriodModal.tsx` — inline expected/mismatch UI
- Call the new hook and compute expected totals for banks / EVD / Float / grand total.
- Per field, show a small line under the input:
  - Green "Matches expected X" when entered equals expected.
  - Amber "Expected X · ±Δ" when they differ, plus an amber input border.
- Per section (Banks, EVD, Float): append "/ exp X" next to the subtotal, colored green/amber.
- Add a summary banner at the top:
  - "Expected carry-forward from week of YYYY-MM-DD" with expected grand total.
  - Count of fields that differ from expected.
  - "Use expected" button that auto-fills every input from the expected values.
- Weekly-total footer gets an extra "vs expected X · ±Δ" line.
- Purely additive — validation rules, save flow, and stored shape are unchanged.

## Technical notes
- Comparison uses integer santim, so equality is exact (no float drift).
- Expected values ignore `isPersonal` transactions, matching how the rest of the app treats them.
- Mismatch styling uses amber (`border-amber-500/70`) and never blocks saving — a legitimate reason to override expected (adjustment, correction) must still be allowed. Real invalid input keeps the existing red `aria-invalid` + destructive text.
- The hook is `useLiveQuery`-based, so edits to prior-week transactions update the expected numbers in real time.
