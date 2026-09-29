// The save gate for the artist facts, and the paths that must NOT be able to write them.
/**
 * saveSeoField is the ONLY write path for the fact keys (bridge 0.43.0 FACT_CONTENT_KEYS).
 * They go to the live site's fact card, so: STRICT, red-first (AGENTS.md "Test depth").
 *
 *  • the gate stores the CLEANED value (one line; the alias list one name per line; a known
 *    country in the table spelling), never the raw input;
 *  • the alias rule needs the artist's name, which the gate reads itself (a caller cannot
 *    pass a stale one), and a failed read refuses rather than stores unchecked;
 *  • the editor's custom-field path and a built-in manifest cannot write a fact key at all.
 *
 * The fake client records what reaches each table. No DB.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { FACT_CONTENT_KEYS } from '@samfox1/site-bridge/seo'
import { SEO_FIELDS } from '@/lib/site-content-schema'
import { FACT_KEYS } from '@/lib/seo-facts'
import { SEO_LIMITS, saveEditorField, saveSeoField, seoValueError } from '@/lib/site-editor/save'

const K = FACT_CONTENT_KEYS
const NOW = new Date('2026-09-28T12:00:00Z')

function fake(artist: { data: { name: string | null } | null; error: { message: string } | null } = { data: { name: 'Skeen' }, error: null }) {
  const upserts: { key: string; value: string }[] = []
  const deletes: string[] = []
  const artistReads: string[] = []
  const client = {
    from: (table: string) => {
      if (table === 'artists') {
        return {
          select: (cols: string) => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: () => {
                artistReads.push(`${cols}:${id}`)
                return Promise.resolve(artist)
              },
            }),
          }),
          update: () => {
            throw new Error('a fact must never write the artists row')
          },
        }
      }
      if (table !== 'site_content') throw new Error(`unexpected table ${table}`)
      return {
        upsert: (row: { key: string; value: string }) => {
          upserts.push({ key: row.key, value: row.value })
          return Promise.resolve({ error: null })
        },
        delete: () => {
          const chain: Record<string, unknown> = {
            eq: (col: string, val: string) => {
              if (col === 'key') deletes.push(val)
              return chain
            },
            then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          }
          return chain
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, upserts, deletes, artistReads }
}

describe('the fact keys are SEO keys', () => {
  it('every fact key is in SEO_FIELDS (so it is reserved and publishes with the site text)', () => {
    for (const k of FACT_KEYS) expect(SEO_FIELDS.map((f) => f.key), k).toContain(k)
  })
  it('region and country are capped in SEO_LIMITS (the page counter reads the same table)', () => {
    expect(SEO_LIMITS[K.region]).toBe(60)
    expect(SEO_LIMITS[K.country]).toBe(60)
  })
})

describe('seoValueError on the fact keys', () => {
  const ctx = { artistName: 'Skeen', thisYear: 2026 }
  it('blank is always fine', () => {
    for (const k of FACT_KEYS) expect(seoValueError(k, '', ctx), k).toBeNull()
  })
  it('each rule applies', () => {
    expect(seoValueError(K.region, '<b>IL</b>', ctx)).toBe('Leave out < and >.')
    expect(seoValueError(K.country, 'x'.repeat(61), ctx)).toBe('Keep it under 60 characters.')
    expect(seoValueError(K.aliases, 'skeen', ctx)).toBe('"skeen" is the artist\'s name already.')
    expect(seoValueError(K.activeSince, '2027', ctx)).toBe('Use a year from 1900 to 2026.')
    expect(seoValueError(K.activeSince, '2014', ctx)).toBeNull()
  })
})

describe('saveSeoField stores the cleaned fact', () => {
  it('region: one line', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.region, '  Cook\n\nCounty \u200F', NOW)).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.region, value: 'Cook County' }])
  })

  it('country: the table spelling when known, as typed when not', async () => {
    const f = fake()
    await saveSeoField(f.client, 'a1', K.country, 'usa', NOW)
    await saveSeoField(f.client, 'a1', K.country, 'Narnia', NOW)
    expect(f.upserts).toEqual([
      { key: K.country, value: 'United States' },
      { key: K.country, value: 'Narnia' },
    ])
  })

  it('CRITICAL: other names keep one per line (the one-line rule would merge them into one name)', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.aliases, ' DJ Skeen \r\n\nSKN ', NOW)).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.aliases, value: 'DJ Skeen\nSKN' }])
  })

  it('CRITICAL: other names are checked against the artist name the gate reads itself', async () => {
    const f = fake({ data: { name: 'Skeen' }, error: null })
    expect(await saveSeoField(f.client, 'a1', K.aliases, 'DJ Skeen\nSKEEN', NOW)).toEqual({ ok: false, error: '"SKEEN" is the artist\'s name already.' })
    expect(f.artistReads).toEqual(['name:a1'])
    expect(f.upserts).toEqual([])
  })

  it('a failed name read refuses: an unchecked list is never stored', async () => {
    for (const artist of [{ data: null, error: { message: 'boom' } }, { data: null, error: null }]) {
      const f = fake(artist)
      const r = await saveSeoField(f.client, 'a1', K.aliases, 'DJ Skeen', NOW)
      expect(r.ok).toBe(false)
      expect(f.upserts).toEqual([])
    }
  })

  it('clearing other names deletes the row without needing the name', async () => {
    const f = fake({ data: null, error: { message: 'unreachable' } })
    expect(await saveSeoField(f.client, 'a1', K.aliases, ' \n ', NOW)).toEqual({ ok: true })
    expect(f.deletes).toEqual([K.aliases])
    expect(f.artistReads).toEqual([])
  })

  it('active since: "this year" comes from the clock it is given', async () => {
    const f = fake()
    expect(await saveSeoField(f.client, 'a1', K.activeSince, '2027', NOW)).toEqual({ ok: false, error: 'Use a year from 1900 to 2026.' })
    expect(await saveSeoField(f.client, 'a1', K.activeSince, '2027', new Date('2027-01-02T00:00:00Z'))).toEqual({ ok: true })
    expect(f.upserts).toEqual([{ key: K.activeSince, value: '2027' }])
  })

  it('CRITICAL: hostile input is refused and nothing is written', async () => {
    const f = fake()
    for (const [k, v] of [
      [K.region, '</script><script>alert(1)</script>'],
      [K.country, 'US\u0000'],
      [K.aliases, 'DJ Skeen\n<img src=x onerror=alert(1)>'],
      [K.activeSince, '2014<'],
      [K.region, 'x'.repeat(10_000)],
      [K.aliases, Array.from({ length: 6 }, (_, i) => `n${i}`).join('\n')],
    ] as const) {
      const r = await saveSeoField(f.client, 'a1', k, v, NOW)
      expect(r.ok, `${k}: ${v.slice(0, 40)}`).toBe(false)
    }
    expect(f.upserts).toEqual([])
    expect(f.deletes).toEqual([])
  })
})

describe('CRITICAL: no other editor path can write a fact key', () => {
  it('a custom site field named like a fact is reserved', async () => {
    for (const k of FACT_KEYS) {
      const f = fake()
      expect(await saveEditorField(f.client, 'a1', null, k, 'Illinois'), k).toEqual({ ok: false, error: 'That field name is reserved.' })
      expect(f.upserts).toEqual([])
      expect(f.deletes).toEqual([])
    }
  })
  it('a built-in template declares none of them', async () => {
    for (const template of ['cinematic', 'classic']) {
      for (const k of FACT_KEYS) {
        const f = fake()
        expect(await saveEditorField(f.client, 'a1', template, k, 'Illinois'), `${template} ${k}`).toEqual({ ok: false, error: 'Unknown field.' })
        expect(f.upserts).toEqual([])
      }
    }
  })
})
