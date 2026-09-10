// The bridge imports cleanly on the server, where there is no DOM at all.
/**
 * THE PACKAGE IMPORTS CLEANLY WITHOUT A DOM (SITE_BRIDGE_PLAN.md P1/P3).
 *
 * Sites call the bridge from SERVER components (skeen resolves region styles during
 * SSR), so one stray top-level `document`/`window` touch in any module breaks every
 * consumer's build. This suite runs in NODE — no jsdom docblock, deliberately: the
 * import itself is the assertion. The DOM-touching functions may exist; they must not
 * RUN at import time.
 */
import { describe, expect, it } from 'vitest'

describe('site-bridge is importable where no DOM exists', () => {
  it('CRITICAL: every exported module imports in a bare node environment', async () => {
    // The list is DERIVED from the package's exports map (AGENTS.md rule 4: a
    // hand-written list silently omits every future member — the 2026-08-07 review
    // caught this one as exactly that shape). Dynamic imports so a throw is a test
    // failure here, not a suite-load crash.
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync('packages/site-bridge/package.json', 'utf8'))
    const entries = Object.keys(pkg.exports).filter((e) => !e.endsWith('.css'))
    expect(entries.length).toBeGreaterThan(3) // the sweep found the exports map
    const mods = await Promise.all(
      entries.map((e) => import('@samfox1/site-bridge' + e.slice(1))),
    )
    expect(mods.every((m) => typeof m === 'object')).toBe(true)
    expect(typeof window).toBe('undefined') // prove this really is node
  })

  it('server-safe machinery WORKS without a DOM, not merely loads', async () => {
    const { resolveRegionStyle, regionProps } = await import('@samfox1/site-bridge/styles')
    // The exact call skeen makes during SSR.
    const r = resolveRegionStyle('work_section', 'relative z-0', 'bg-black')
    expect(r.className).toBe('bg-black')
    expect(regionProps({}, 'work_section', false, 'relative z-0').className).toBe('relative z-0')
  })
})
