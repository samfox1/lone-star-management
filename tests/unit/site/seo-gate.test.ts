/**
 * saveSeoField's gate (SEO_GEO_PLAN B6): the only write path for the SEO_FIELDS keys,
 * which rewrite <head>. Derived from SEO_FIELDS, so a key added to the schema without a
 * rule here is refused, never silently accepted.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { FAQ_EXTRA, FAQ_KEYS, SEO_FIELDS } from '@/lib/site-content-schema'
import { SEO_LIMITS, saveSeoField, seoValueError } from '@/lib/site-editor/save'
import { ABOUT_PLACEMENTS } from '@samfox1/site-bridge/seo'

/** Fake site_content table: records what the gate actually decided to store. No DB. */
function fake() {
  const upserts: { key: string; value: string }[] = []
  const deletes: string[] = []
  const client = {
    from: () => ({
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
    }),
  } as unknown as SupabaseClient
  return { client, upserts, deletes }
}

describe('seoValueError', () => {
  it('every SEO_FIELDS key has a rule (blank is always fine)', () => {
    for (const f of SEO_FIELDS) expect(seoValueError(f.key, ''), f.key).toBeNull()
    expect(seoValueError('not_a_seo_key', 'x')).toBe('Unknown SEO field.')
  })
  it('CRITICAL: og_image is https only — a javascript: URL never reaches og:image', () => {
    expect(seoValueError('og_image', 'https://cdn.example.com/card.png')).toBeNull()
    expect(seoValueError('og_image', 'javascript:alert(1)')).toBeTruthy()
    // http:// is a mixed-content preview image on an https site — most scrapers drop it.
    expect(seoValueError('og_image', 'http://cdn.example.com/card.png')).toBeTruthy()
    expect(seoValueError('og_image', 'data:image/png;base64,AAAA')).toBeTruthy()
  })
  it('about_placement must be in the registry', () => {
    for (const p of ABOUT_PLACEMENTS) expect(seoValueError('about_placement', p)).toBeNull()
    expect(seoValueError('about_placement', 'sidebar')).toBe('Unknown about placement.')
  })
  it('strings are capped by SEO_LIMITS', () => {
    for (const [key, max] of Object.entries(SEO_LIMITS)) {
      expect(seoValueError(key, 'x'.repeat(max)), key).toBeNull()
      expect(seoValueError(key, 'x'.repeat(max + 1)), key).toBeTruthy()
    }
  })
  it('FAQ answers are SEO keys too: gated, capped, five of them in order', () => {
    expect(FAQ_KEYS).toEqual([1, 2, 3, 4, 5].map((n) => `faq_answer_${n}`))
    for (const k of FAQ_KEYS) {
      expect(seoValueError(k, 'x'.repeat(1200))).toBeNull()
      expect(seoValueError(k, 'x'.repeat(1201))).toBeTruthy()
    }
  })
  it('extra questions: five slots, question capped at 200, answer at 1200', () => {
    expect(FAQ_EXTRA).toHaveLength(5)
    expect(seoValueError(FAQ_EXTRA[0].q, 'x'.repeat(201))).toBeTruthy()
    expect(seoValueError(FAQ_EXTRA[0].a, 'x'.repeat(1200))).toBeNull()
  })
})

/**
 * What saveSeoField STORES (review 2026-09-03, M8). The gate collapsed every run of
 * whitespace, which is right for a one-line <head> string and destroys a manager's
 * two-paragraph FAQ answer — a value the fact sheet renders as prose. The sets below are
 * derived from the registry (AGENTS.md rule 4): a sixth probe answer or a sixth extra
 * slot joins the right one the day it is added to SEO_FIELDS.
 */
describe('saveSeoField keeps prose readable and <head> on one line', () => {
  /** The prose answers: rendered as paragraphs on /faqsheet, edited in a textarea. */
  const PROSE = [...FAQ_KEYS, ...FAQ_EXTRA.map((e) => e.a)]
  /** Every other length-capped SEO string. og_image / about_placement are shape-validated
   *  rather than length-capped, so they are not in SEO_LIMITS and not in this loop. */
  const ONE_LINE = Object.keys(SEO_LIMITS).filter((k) => !PROSE.includes(k))

  it('CRITICAL: a prose answer keeps its paragraph break', async () => {
    for (const key of PROSE) {
      const { client, upserts } = fake()
      const r = await saveSeoField(client, 'a1', key, 'We play house.\n\nMostly in Chicago.')
      expect(r.ok, key).toBe(true)
      expect(upserts.at(-1), key).toEqual({ key, value: 'We play house.\n\nMostly in Chicago.' })
    }
  })

  it('a prose answer is still tidied: CRLF, runs of spaces, and blank-line pileups', async () => {
    const { client, upserts } = fake()
    await saveSeoField(client, 'a1', FAQ_KEYS[0], '  One.\r\n\r\n\r\n\r\n  Two   words.  \n  ')
    expect(upserts.at(-1)!.value).toBe('One.\n\nTwo words.')
  })

  it('CRITICAL: a one-line field still collapses newlines — <head> takes no breaks', async () => {
    for (const key of ONE_LINE) {
      const { client, upserts } = fake()
      const r = await saveSeoField(client, 'a1', key, 'One.\n\nTwo.')
      expect(r.ok, key).toBe(true)
      expect(upserts.at(-1), key).toEqual({ key, value: 'One. Two.' })
    }
  })

  it('blank still clears the row, on both sides of the rule', async () => {
    for (const key of [FAQ_KEYS[0], 'seo_title']) {
      const { client, upserts, deletes } = fake()
      expect((await saveSeoField(client, 'a1', key, '  \n\n  ')).ok).toBe(true)
      expect(upserts).toEqual([])
      expect(deletes).toEqual([key])
    }
  })

  it('the length cap is measured on what gets stored', async () => {
    const { client, upserts } = fake()
    // Exactly the 1200-char cap, paragraph breaks included: they survive, so they count.
    const long = `${'x'.repeat(599)}\n\n${'y'.repeat(599)}`
    expect(long).toHaveLength(SEO_LIMITS[FAQ_KEYS[0]])
    expect((await saveSeoField(client, 'a1', FAQ_KEYS[0], long)).ok).toBe(true)
    expect(upserts.at(-1)!.value).toBe(long)
    expect((await saveSeoField(client, 'a1', FAQ_KEYS[0], `${long}z`)).ok).toBe(false)
  })
})
