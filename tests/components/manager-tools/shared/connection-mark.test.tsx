// @vitest-environment jsdom
/**
 * Every connection draws its own brand mark, in the row's colour.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/_ui/connection-mark.tsx
 * Feature:  the connection marks on Connections, the SEO Profiles tab and the editor's links
 *           (Sam, 2026-09-28: "Each connection should have an icon associated with it";
 *           services had borrowed dashboard glyphs)
 * Tier:     LIGHT (AGENTS.md "Test depth"): a look, but one sweep over every connection, so a
 *           new one drawn with the fallback glyph fails here.
 * Covers:   • each connection draws its own brand path: socials the bridge's, services the
 *             dashboard's, monochrome (currentColor) so it takes the row's colour
 * Not here: that every service has an icon generated at all
 *           (tests/unit/manager-tools/connections/service-icons.test.ts).
 * Fixtures: none: it renders the real CONNECTIONS list.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { ConnectionMark } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/connection-mark'
import { CONNECTIONS } from '@/lib/connections'
import { SERVICE_ICONS } from '@/lib/service-icons'

afterEach(cleanup)

describe('ConnectionMark', () => {
  // Every connection, its own path: a missing one would draw the generic link glyph unnoticed.
  it('CRITICAL: every connection draws its own brand path, in currentColor', () => {
    for (const def of CONNECTIONS) {
      const { container } = render(<ConnectionMark def={def} />)
      const want = def.social ? socialIcon(def.social)?.path : SERVICE_ICONS[def.key]?.path
      expect(container.querySelector('path')?.getAttribute('d'), def.key).toBe(want)
      expect(container.querySelector('svg')?.getAttribute('fill'), def.key).toBe('currentColor')
      cleanup()
    }
  })
})
