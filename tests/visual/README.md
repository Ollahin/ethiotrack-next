# Responsive Visual Tests

Automated Playwright checks that guard the dashboard layout across mobile,
tablet, and desktop breakpoints.

## What it covers

| Viewport | Size      | Expected layout          |
| -------- | --------- | ------------------------ |
| Mobile   | 390×844   | Floating bottom tab bar  |
| Tablet   | 820×1180  | Sidebar rail             |
| Desktop  | 1440×900  | Sidebar rail             |

For each viewport it asserts:

- `<nav>` renders and has non-zero width
- Hero card ("This week") renders
- The four dashboard tiles render
- No horizontal overflow (`scrollWidth == innerWidth`)
- Mobile nav is anchored to the bottom; tablet/desktop nav is a narrow sidebar
- No console errors and no uncaught page errors during load

A screenshot is written to `tests/visual/screenshots/<viewport>.png` on
every run so regressions can be diffed visually.

## Running

```bash
# Dev server must be running on http://localhost:8080
python tests/visual/responsive.py
```

Exit code is non-zero if any breakpoint fails an invariant, so this can be
wired directly into CI.

## Adding a viewport

Append an entry to `BREAKPOINTS` in `responsive.py`. `layout` must be
either `"floating-tabs"` (mobile) or `"sidebar"` (tablet/desktop) — that
drives the nav-placement assertion.

## Notes

- Each run uses a fresh browser context, so the app boots at the PIN-setup
  screen. The helper sets PIN `1234` and dismisses the open-week modal.
- Screenshots are viewport-sized (no `full_page`) to keep diffs small and
  predictable.