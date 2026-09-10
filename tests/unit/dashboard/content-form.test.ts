// Turning a submitted form into the columns written to a row.
/**
 * The FORM → row rule (lib/content-form.ts): how submitted FormData becomes the
 * column set handed to createContent / updateContent.
 *
 * The array cases carry the weight. `support` (a tour date's other acts) is the
 * first column that arrives as REPEATED FormData entries rather than one value, and
 * two of its behaviours are easy to get silently wrong: reading it with `get`
 * instead of `getAll` keeps only the first act, and treating "no entries" as
 * "absent" makes a cleared list unsaveable forever. Both are asserted here.
 */
import { describe, expect, it } from 'vitest'
import { extractFields, extractUpdate } from '@/lib/content-form'

/** Build FormData; an array value becomes one entry per item, as a form posts it. */
function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item)
    else f.set(k, v)
  }
  return f
}

describe('extractFields (create)', () => {
  it('keeps only filled fields, so untouched ones fall through to the DB default', () => {
    const out = extractFields('tour_date', fd({ date: '2026-09-12', city: 'Austin', venue: '', ticket_url: '' }))
    expect(out).toEqual({ date: '2026-09-12', city: 'Austin' })
  })

  it('reads every tag of an array field, not just the first', () => {
    const out = extractFields('tour_date', fd({ date: '2026-09-12', support: ['Arlo', 'Bo Reed'] }))
    expect(out.support).toEqual(['Arlo', 'Bo Reed'])
  })

  it('drops the blank presence sentinel TagInput posts, so it never becomes a tag', () => {
    const out = extractFields('tour_date', fd({ date: '2026-09-12', support: ['', 'Arlo'] }))
    expect(out.support).toEqual(['Arlo'])
  })

  it('omits an empty array field entirely, leaving the column default to win', () => {
    // Sentinel only — the manager added no acts. Writing [] here would be equivalent
    // today, but omitting is what every other untouched field does.
    const out = extractFields('tour_date', fd({ date: '2026-09-12', support: [''] }))
    expect(out).not.toHaveProperty('support')
  })

  it('keeps a comma INSIDE one tag: the chips are the separator, not the comma', () => {
    // The whole reason support is a tag input rather than a comma-split text field.
    const out = extractFields('tour_date', fd({ date: '2026-09-12', support: ['Crosby, Stills & Nash'] }))
    expect(out.support).toEqual(['Crosby, Stills & Nash'])
  })

  it('caps tags, so a scripted form cannot write an unbounded array', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Act ${i}`)
    const out = extractFields('tour_date', fd({ date: '2026-09-12', support: many }))
    expect(out.support).toHaveLength(20)
  })

  it('drops a dangerous URL scheme rather than persisting it', () => {
    const out = extractFields('tour_date', fd({ date: '2026-09-12', ticket_url: 'javascript:alert(1)' }))
    expect(out).not.toHaveProperty('ticket_url')
  })

  it('ignores fields outside the type allowlist', () => {
    const out = extractFields('tour_date', fd({ date: '2026-09-12', on_site: 'true', source: 'bandsintown' }))
    expect(out).toEqual({ date: '2026-09-12' })
  })

  it("coerces the 'old show' toggle to a real boolean", () => {
    // The form posts 'true'/'false' (a BoolToggle hidden input), not the string.
    expect(extractFields('tour_date', fd({ venue: 'X', is_past: 'true' })).is_past).toBe(true)
    expect(extractFields('tour_date', fd({ venue: 'X', is_past: 'false' })).is_past).toBe(false)
  })

  it('omits an untouched toggle so the column default (false) wins on create', () => {
    // An empty raw value is skipped like any untouched field.
    expect(extractFields('tour_date', fd({ venue: 'X', is_past: '' }))).not.toHaveProperty('is_past')
  })
})

describe('extractUpdate (edit)', () => {
  it('touches only the fields the form actually submitted', () => {
    const out = extractUpdate('tour_date', fd({ venue: 'Mohawk' }))
    expect(out).toEqual({ venue: 'Mohawk' })
  })

  it('nulls a cleared optional field, so a manager can empty it', () => {
    const out = extractUpdate('tour_date', fd({ venue: '' }))
    expect(out).toEqual({ venue: null })
  })

  it('never nulls a required field', () => {
    // A link's label is NOT NULL; clearing it must be ignored, not written as null.
    const out = extractUpdate('link', fd({ label: '' }))
    expect(out).not.toHaveProperty('label')
  })

  it("clears a tour date's date, now that it's optional (a TBA row)", () => {
    // `date` left CRUD.tour_date.required when the column became nullable
    // (20260716120000), so a blank date is a deliberate clear, not a no-op.
    const out = extractUpdate('tour_date', fd({ date: '' }))
    expect(out).toEqual({ date: null })
  })

  it('CLEARS an array field when every chip is removed', () => {
    // The sentinel is the only entry left, so the field is still present. If this
    // regressed to "absent means untouched", a manager could never remove the last
    // supporting act — it would silently keep the old value on every save.
    const out = extractUpdate('tour_date', fd({ support: [''] }))
    expect(out.support).toEqual([])
  })

  it('leaves an array field alone when the form omits it entirely', () => {
    // A form with no support control at all (e.g. a future partial edit form) must
    // not wipe the column.
    const out = extractUpdate('tour_date', fd({ venue: 'Mohawk' }))
    expect(out).not.toHaveProperty('support')
  })

  it('replaces the whole tag list rather than merging', () => {
    const out = extractUpdate('tour_date', fd({ support: ['', 'Bo Reed'] }))
    expect(out.support).toEqual(['Bo Reed'])
  })

  it('writes the old-show toggle both ways, so it can be turned off', () => {
    // BoolToggle always posts a value (hidden input), so unlike a bare checkbox the
    // field is present on both true and false — turning it off is a real save.
    expect(extractUpdate('tour_date', fd({ is_past: 'true' })).is_past).toBe(true)
    expect(extractUpdate('tour_date', fd({ is_past: 'false' })).is_past).toBe(false)
  })
})
