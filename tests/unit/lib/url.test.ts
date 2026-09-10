// Which URLs are safe to render or store, and telling a social link from a contact link.
import { describe, expect, it } from 'vitest'
import { isContactLink, isUrlField, safeHref } from '@/lib/url'

describe('safeHref', () => {
  it('allows http/https/mailto/tel and relative URLs', () => {
    for (const ok of [
      'https://example.com/x',
      'http://example.com',
      'mailto:band@example.com',
      'tel:+15125551234',
      '/merch',
      '#top',
      'shop/page',
    ]) {
      expect(safeHref(ok)).toBe(ok)
    }
  })

  it('rejects dangerous schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://x/y',
      'file:///etc/passwd',
    ]) {
      expect(safeHref(bad)).toBeUndefined()
    }
  })

  it('returns undefined for empty/nullish', () => {
    expect(safeHref('')).toBeUndefined()
    expect(safeHref('   ')).toBeUndefined()
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
  })
})

describe('isUrlField — the write-side sanitization allowlist', () => {
  /**
   * Every column here is run through safeHref before it is persisted
   * (content-form.ts extractFields). A column dropped from the allowlist keeps
   * rendering as an href and simply stops being validated on the way in, which is
   * invisible until a `javascript:` value is already in the database. Each name is
   * asserted individually so a deletion fails, rather than a count that a rename
   * would satisfy.
   */
  it('covers every column that is rendered as an href/src', () => {
    for (const field of [
      'url',
      'stream_url',
      'ticket_url',
      'cover_url',
      'image_url',
      'hero_image_url',
      'apple_url',
      'soundcloud_url',
      'deezer_url',
      'provider_url',
    ]) {
      expect(isUrlField(field), field).toBe(true)
    }
  })

  it('leaves free-text columns alone', () => {
    // safeHref would silently drop a title containing a colon-prefixed word, so the
    // allowlist has to stay an allowlist and not creep into "anything ending in _url".
    for (const field of ['title', 'venue', 'bio', 'label', 'description', 'storage_path', 'audio_path']) {
      expect(isUrlField(field), field).toBe(false)
    }
  })
})

describe('isContactLink — Socials vs Contact in the editor', () => {
  it('a mailto/tel link is a contact route', () => {
    expect(isContactLink('mailto:book@skeen.fm')).toBe(true)
    expect(isContactLink('tel:+15125551234')).toBe(true)
  })

  it('a profile a fan follows is not', () => {
    for (const url of ['https://instagram.com/skeen', 'http://x.com/skeen', '/merch', 'skeen.fm']) {
      expect(isContactLink(url), url).toBe(false)
    }
  })

  it('reads the scheme the BROWSER sees, not the literal string', () => {
    // Browsers ignore leading whitespace and control chars in the scheme token and are
    // case-insensitive about it, so `  MAILTO:x` is a live mailto link. Matching on the
    // raw string would file it under Socials, where the manager would never find the
    // booking address they are looking for.
    expect(isContactLink(' mailto:book@skeen.fm')).toBe(true)
    expect(isContactLink('MAILTO:book@skeen.fm')).toBe(true)
    expect(isContactLink('mail\tto:book@skeen.fm')).toBe(true)
    expect(isContactLink('Tel:+15125551234')).toBe(true)
  })

  it('is false for nullish and empty, so an un-set link falls under Socials', () => {
    expect(isContactLink(null)).toBe(false)
    expect(isContactLink(undefined)).toBe(false)
    expect(isContactLink('')).toBe(false)
  })
})
