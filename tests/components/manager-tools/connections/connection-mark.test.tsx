// @vitest-environment jsdom
/**
 * A connection's mark: the brand's own, for socials (the bridge) AND services (Sam,
 * 2026-09-28: "Each connection should have an icon associated with it" — services had
 * borrowed dashboard glyphs). Drawn monochrome (currentColor), so it takes the row's colour.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { socialIcon } from '@samfox1/site-bridge/social-icons'
import { ConnectionMark } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-mark'
import { CONNECTIONS } from '@/lib/connections'
import { SERVICE_ICONS } from '@/lib/service-icons'

afterEach(cleanup)

describe('ConnectionMark', () => {
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
