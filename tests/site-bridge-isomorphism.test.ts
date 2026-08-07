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
  it('CRITICAL: every module imports in a bare node environment', async () => {
    // Dynamic imports so a throw is a test failure here, not a suite-load crash.
    const mods = await Promise.all([
      import('@lone-star/site-bridge'),
      import('@lone-star/site-bridge/protocol'),
      import('@lone-star/site-bridge/payload'),
      import('@lone-star/site-bridge/manifest'),
      import('@lone-star/site-bridge/markers'),
      import('@lone-star/site-bridge/styles'),
      import('@lone-star/site-bridge/frame'),
    ])
    expect(mods.every((m) => typeof m === 'object')).toBe(true)
    expect(typeof window).toBe('undefined') // prove this really is node
  })

  it('server-safe machinery WORKS without a DOM, not merely loads', async () => {
    const { resolveRegionStyle, regionProps } = await import('@lone-star/site-bridge/styles')
    // The exact call skeen makes during SSR.
    const r = resolveRegionStyle('work_section', 'relative z-0', 'bg-black')
    expect(r.className).toBe('bg-black')
    expect(regionProps({}, 'work_section', false, 'relative z-0').className).toBe('relative z-0')
  })
})
