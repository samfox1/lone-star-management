// Each kind of site text has one cap, and the panel and the server read the same table.
/**
 * text-limits — the caps the editor's text box and saveEditorField share. The server's
 * refusal is pinned against the live DB in tests/integration/site-editor/
 * editor-field-save.test.ts; this file pins the table and the edges, DB-free.
 */
import { describe, expect, it } from 'vitest'
import { formatCount, isTooLong, nearLimit, textLimit, tooLongError, TEXT_LIMITS } from '@/lib/site-editor/text-limits'

describe('textLimit: the cap follows where the text is written', () => {
  it('a bio gets the long cap, a name the short one, everything else the site-text cap', () => {
    expect(textLimit({ store: 'artist', column: 'bio' })).toBe(TEXT_LIMITS.bio)
    expect(textLimit({ store: 'artist', column: 'name' })).toBe(TEXT_LIMITS.name)
    expect(textLimit({ store: 'site_content', column: undefined })).toBe(TEXT_LIMITS.text)
    expect(textLimit(undefined)).toBe(TEXT_LIMITS.text)
    expect(textLimit(null)).toBe(TEXT_LIMITS.text)
  })

  it('an artist column that is not name or bio is NOT given the bio cap', () => {
    // hero_image_url is image-only; the allowlist must not widen by store alone.
    expect(textLimit({ store: 'artist', column: 'hero_image_url' })).toBe(TEXT_LIMITS.text)
    expect(textLimit({ store: 'site_content', column: 'bio' })).toBe(TEXT_LIMITS.text)
  })

  it('the bio cap is ABOVE the old 2,000 cut — that cut is the bug this replaced', () => {
    expect(TEXT_LIMITS.bio).toBeGreaterThan(2000)
  })
})

describe('isTooLong / nearLimit: counted on the trimmed text', () => {
  it('exactly the cap fits; one more does not', () => {
    expect(isTooLong('x'.repeat(10), 10)).toBe(false)
    expect(isTooLong('x'.repeat(11), 10)).toBe(true)
  })

  it('spaces around a full-length value are not counted', () => {
    expect(isTooLong(`  ${'x'.repeat(10)}  `, 10)).toBe(false)
  })

  it('the counter shows in the last tenth, not before', () => {
    expect(nearLimit('x'.repeat(1799), 2000)).toBe(false)
    expect(nearLimit('x'.repeat(1800), 2000)).toBe(true)
  })
})

describe('the refusal reads the same from the panel and the server', () => {
  it('names the cap with a thousands separator', () => {
    expect(formatCount(10000)).toBe('10,000')
    expect(tooLongError(2000)).toBe('Too long to save. Keep it to 2,000 characters.')
  })
})
