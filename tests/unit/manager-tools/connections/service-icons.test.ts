/**
 * Every connection has its own mark (Sam, 2026-09-28: "Each connection should have an icon
 * associated with it"). Socials use the bridge's brand marks; the services — Shopify,
 * Bandsintown, Ticketmaster, Google Drive — had borrowed dashboard glyphs (a tour ticket, a
 * folder). They now carry their own brand marks, generated from simple-icons (CC0) like the
 * socials. Derived from CONNECTIONS (AGENTS.md rule 4): a new service fails here until it
 * has one.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONNECTIONS } from '@/lib/connections'
import { SERVICE_ICONS } from '@/lib/service-icons'
import { buildServiceIcons } from '../../../../scripts/generate-service-icons'

describe('service icons', () => {
  it('CRITICAL: every service connection has its own brand mark', () => {
    const services = CONNECTIONS.filter((d) => d.kind === 'service').map((d) => d.key)
    expect(services.length).toBeGreaterThan(0) // non-vacuous
    expect(services.filter((k) => !SERVICE_ICONS[k]?.path)).toEqual([])
  })

  it('the committed file is exactly what the generator writes (no hand edits, no stale marks)', () => {
    // Stryker's sandbox adds `// @ts-nocheck` to every src file (disableTypeChecks): at the top,
    // or (now) after the leading doc comment with a blank line. The comparison drops that line
    // wherever it sits; the committed file never carries it.
    const committed = readFileSync(resolve(__dirname, '../../../../src/lib/service-icons.ts'), 'utf8').replace(/^\/\/ @ts-nocheck\r?\n(\r?\n)?/m, '')
    expect(committed).toBe(buildServiceIcons())
  })
})
