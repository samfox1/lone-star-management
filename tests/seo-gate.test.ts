/**
 * saveSeoField's gate (SEO_GEO_PLAN B6): the only write path for the SEO_FIELDS keys,
 * which rewrite <head>. Derived from SEO_FIELDS, so a key added to the schema without a
 * rule here is refused, never silently accepted.
 */
import { describe, expect, it } from 'vitest'
import { SEO_FIELDS } from '@/lib/site-content-schema'
import { SEO_LIMITS, seoValueError } from '@/lib/site-editor/save'
import { ABOUT_PLACEMENTS } from '@samfox1/site-bridge/seo'

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
})
