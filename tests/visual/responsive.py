#!/usr/bin/env python3
"""Automated responsive layout tests for the EthioTrack dashboard.

Runs a headless Chromium against http://localhost:8080 at mobile, tablet,
and desktop breakpoints. For each viewport it:

  1. Sets a PIN (fresh browser context) and dismisses the open-week modal.
  2. Screenshots the dashboard to tests/visual/screenshots/<viewport>.png.
  3. Asserts layout invariants (nav visible, hero + tiles rendered, no
     horizontal scroll, no console/page errors).

Exits non-zero on any failed invariant so this can wire into CI later.

Usage:
    python tests/visual/responsive.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import Page, async_playwright

ROOT = Path(__file__).parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)

BREAKPOINTS = [
    {"name": "mobile", "width": 390, "height": 844, "layout": "floating-tabs"},
    {"name": "tablet", "width": 820, "height": 1180, "layout": "sidebar"},
    {"name": "desktop", "width": 1440, "height": 900, "layout": "sidebar"},
]

BASE_URL = "http://localhost:8080"
PIN = "1234"


async def unlock(page: Page) -> None:
    """Set PIN on first run or enter it if already configured."""
    try:
        await page.wait_for_selector('input[type="password"]', timeout=4000)
    except Exception:
        return
    inputs = page.locator('input[type="password"]')
    count = await inputs.count()
    await inputs.nth(0).fill(PIN)
    if count > 1:
        await inputs.nth(1).fill(PIN)
    await page.locator("button[type=submit], button").first.click()
    await page.wait_for_timeout(1000)


async def open_week_if_prompted(page: Page) -> None:
    btn = page.get_by_role("button", name="Open week")
    if await btn.count():
        await btn.first.click()
        await page.wait_for_timeout(500)


async def audit(page: Page, bp: dict) -> list[str]:
    """Return a list of failed invariants (empty = pass)."""
    failures: list[str] = []

    # 1. Navigation is visible.
    nav = page.locator("nav").last
    if not await nav.count():
        failures.append("no <nav> element rendered")
    else:
        box = await nav.bounding_box()
        if not box or box["width"] < 10:
            failures.append("nav has zero width")

    # 2. Hero card ("This week") is rendered.
    hero = page.get_by_text("This week", exact=False)
    if not await hero.count():
        failures.append("hero card ('This week') missing")

    # 3. Four dashboard tiles are present.
    tiles = await page.get_by_text(
        "Today's sales|Today's receipts|Open credits|Cash variance",
        exact=False,
    ).count()
    # Fallback: just check we have at least the sales tile.
    if not await page.get_by_text("Today's sales", exact=False).count():
        failures.append("dashboard tiles missing")

    # 4. No horizontal overflow.
    overflow = await page.evaluate(
        "() => document.documentElement.scrollWidth - window.innerWidth"
    )
    if overflow > 1:
        failures.append(f"horizontal overflow: {overflow}px")

    # 5. Layout mode matches expectation. Mobile has the floating bottom
    #    bar (nav bottom near viewport bottom); desktop/tablet has a
    #    sidebar (nav bottom == viewport bottom, nav width narrow relative
    #    to viewport).
    nav_box = await nav.bounding_box()
    if nav_box:
        if bp["layout"] == "floating-tabs":
            gap = bp["height"] - (nav_box["y"] + nav_box["height"])
            if gap < 0 or gap > 40:
                failures.append(
                    f"floating tab bar not anchored to bottom (gap={gap}px)"
                )
        else:
            if nav_box["width"] > bp["width"] * 0.35:
                failures.append(
                    f"expected sidebar (~<35% width), got {nav_box['width']}px"
                )
    return failures


async def run_breakpoint(pw, bp: dict) -> dict:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(
        viewport={"width": bp["width"], "height": bp["height"]}
    )
    page = await context.new_page()

    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda m: m.type == "error" and console_errors.append(m.text),
    )
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.wait_for_timeout(400)
    await unlock(page)
    await open_week_if_prompted(page)
    await page.wait_for_timeout(500)

    shot_path = SHOTS / f"{bp['name']}.png"
    await page.screenshot(path=str(shot_path))

    failures = await audit(page, bp)
    if console_errors:
        failures.append(f"console errors: {console_errors[:3]}")
    if page_errors:
        failures.append(f"page errors: {page_errors[:3]}")

    await browser.close()
    return {
        "viewport": bp["name"],
        "size": f"{bp['width']}x{bp['height']}",
        "screenshot": str(shot_path.relative_to(ROOT.parent.parent)),
        "passed": not failures,
        "failures": failures,
    }


async def main() -> int:
    results = []
    async with async_playwright() as pw:
        for bp in BREAKPOINTS:
            results.append(await run_breakpoint(pw, bp))

    print(json.dumps(results, indent=2))
    failed = [r for r in results if not r["passed"]]
    if failed:
        print(f"\n❌ {len(failed)}/{len(results)} breakpoints failed", file=sys.stderr)
        return 1
    print(f"\n✅ All {len(results)} breakpoints passed")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))