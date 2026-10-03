// Turning a manager's typed label into the slug their website will post.
/**
 * `slugFromLabel` / `uniqueSlug` — the pure half of adding an enquiry kind.
 *
 * WHY THIS IS NOT COSMETIC. The slug is the word the artist's SITE posts in `purpose`,
 * it is immutable once created (a trigger refuses any change — renaming it would leave
 * the site sending a word that matches no kind, silently skipping that kind's recipient
 * list), and `ek_slug_fmt` refuses anything outside `^[a-z0-9][a-z0-9-]{0,39}$`. So a
 * derivation that emits something malformed does not produce a wrong-looking name; it
 * produces an insert that fails, or — worse, if the CHECK ever loosened — a kind nothing
 * can ever route to and nobody can rename.
 *
 * Every case below is a real thing a manager might type into "Add kind".
 */
import { describe, expect, it } from 'vitest'
import { DESCRIPTION_MAX, LABEL_MAX, RECIPIENT_CAP, SLUG_MAX, kindDetailsUpdate, kindLabeller, labelFromSlug, recipientProblem, slugFromLabel, toKindRows, uniqueSlug, kindGuide } from '@/lib/enquiries/kinds'

/** The CHECK on enquiry_kinds.slug, copied here so these tests fail if they disagree. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

describe('slugFromLabel', () => {
  it('lowercases and hyphenates the ordinary cases', () => {
    expect(slugFromLabel('Booking')).toBe('booking')
    expect(slugFromLabel('Sync licensing')).toBe('sync-licensing')
    expect(slugFromLabel('Press & PR')).toBe('press-pr')
  })

  it('strips accents rather than dropping the letters', () => {
    // 'Café' → 'cafe', not 'caf'. Dropping characters silently changes the word.
    expect(slugFromLabel('Café bookings')).toBe('cafe-bookings')
    expect(slugFromLabel('Señor')).toBe('senor')
  })

  it('collapses runs of punctuation and space into ONE hyphen', () => {
    expect(slugFromLabel('A  --  B')).toBe('a-b')
    expect(slugFromLabel('one / two / three')).toBe('one-two-three')
  })

  it('never begins or ends with a hyphen', () => {
    // The CHECK requires the FIRST character to be alphanumeric, so a leading hyphen is
    // not untidy — it is an insert that fails.
    expect(slugFromLabel('  --Press--  ')).toBe('press')
    expect(slugFromLabel('!!!Demos!!!')).toBe('demos')
  })

  it('truncates to 40 characters', () => {
    const slug = slugFromLabel('a'.repeat(38) + ' bookings')
    expect(slug).toBe('a'.repeat(38) + '-b')
    expect(slug).toMatch(SLUG_RE)
  })

  it('truncates without leaving a trailing hyphen when the cut LANDS on one', () => {
    // 39 characters then a separator puts the hyphen at index 39 — exactly the last
    // character `slice(0, 40)` keeps. The earlier truncation test cuts mid-word and never
    // reaches this line; found by deleting the post-slice trim and watching it stay green.
    const slug = slugFromLabel('a'.repeat(39) + ' bookings')

    expect(slug).toBe('a'.repeat(39))
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toMatch(SLUG_RE)
  })

  it('falls back to a usable word when nothing survives', () => {
    // A label of pure punctuation or non-Latin script leaves no slug. Returning '' would
    // fail the CHECK; the caller has no better answer to offer than a generic one.
    for (const label of ['', '   ', '!!!', '---', '。。。']) {
      expect(slugFromLabel(label), JSON.stringify(label)).toBe('kind')
    }
  })

  it('never emits a slug the database would refuse', () => {
    const labels = [
      'Booking', 'Sync licensing', 'Press & PR', 'Café bookings', '  --Press--  ',
      '!!!', '', '   ', '123 Go', 'x'.repeat(200), 'A  --  B', 'Señor', '。。。',
      'UPPER CASE', 'trailing-', '-leading', 'tabs\tand\nnewlines',
    ]
    for (const label of labels) {
      expect(slugFromLabel(label), `label ${JSON.stringify(label)}`).toMatch(SLUG_RE)
    }
  })

  it('keeps a leading digit, which the CHECK allows', () => {
    expect(slugFromLabel('123 Go')).toBe('123-go')
  })
})

describe('uniqueSlug', () => {
  it('returns the base when nothing has claimed it', () => {
    expect(uniqueSlug('press', [])).toBe('press')
    expect(uniqueSlug('press', ['booking', 'demo'])).toBe('press')
  })

  it('counts up past a collision', () => {
    // (artist_id, slug) is UNIQUE. Without this the second "Press" is a 23505 the manager
    // has to decipher, when the obvious intent is a second list.
    expect(uniqueSlug('press', ['press'])).toBe('press-2')
    expect(uniqueSlug('press', ['press', 'press-2'])).toBe('press-3')
  })

  it('compares case-insensitively, because the stored slug is lowercase', () => {
    expect(uniqueSlug('press', ['PRESS'])).toBe('press-2')
  })

  it('keeps the suffixed slug within 40 characters', () => {
    // Appending to a slug already at the limit would push it over the CHECK. The base has
    // to give ground, not the suffix — the suffix is what makes it unique.
    const base = 'a'.repeat(40)
    const out = uniqueSlug(base, [base])

    expect(out.length).toBeLessThanOrEqual(40)
    expect(out).toMatch(SLUG_RE)
    expect(out).not.toBe(base)
    expect(out.endsWith('-2')).toBe(true)
  })

  it('does not leave a double hyphen when the cut LANDS on one', () => {
    // THIS TEST WAS VACUOUS and mutation testing caught it: the old base was
    // `'a'.repeat(39) + '-'.replace('-', 'b')`, which is 'aaa…b' and contains no hyphen at
    // all, so the trim it claimed to exercise was never reached. Deleting that trim left
    // every test green.
    //
    // 37 a's then a hyphen puts the hyphen at index 37 — the last character kept by
    // `slice(0, 40 - '-2'.length)`. Without the trim the result is 'aaa…--2', which still
    // MATCHES SLUG_RE (a hyphen mid-string is legal), so the exact value is the only
    // assertion that bites here.
    const base = 'a'.repeat(37) + '-bb'
    expect(base).toHaveLength(SLUG_MAX)

    const out = uniqueSlug(base, [base])

    expect(out).toBe('a'.repeat(37) + '-2')
    expect(out).not.toContain('--')
    expect(out).toMatch(SLUG_RE)
  })
})

describe('uniqueSlug — an empty base', () => {
  it('still yields a slug the database accepts', () => {
    // `uniqueSlug` is exported and takes any base, so the `|| SLUG_FALLBACK` guard IS
    // reachable from outside even though slugFromLabel never hands it ''. Mutation testing
    // found it unwatched; this is the one input that reaches it.
    expect(uniqueSlug('', [''])).toBe('kind-2')
  })
})

describe('labelFromSlug — the fallback the inbox and the email subject share', () => {
  it('matches SQL initcap(replace(slug, \'-\', \' \'))', () => {
    // submit_enquiry uses exactly that for purpose_label when no kind carries a label. If
    // the two ever diverge the inbox and the mail disagree about the same enquiry.
    expect(labelFromSlug('sync-licensing')).toBe('Sync Licensing')
    expect(labelFromSlug('press')).toBe('Press')
    expect(labelFromSlug('a-b-c')).toBe('A B C')
  })

  it('tolerates a stray hyphen without emitting an empty word', () => {
    expect(labelFromSlug('press-')).toBe('Press')
  })
})

describe('kindLabeller — labels come from the table, never a map', () => {
  it('returns the artist\'s own label for a known slug', () => {
    // This is what retired the three-entry PURPOSE_LABEL map in the inbox: a manager who
    // renames "Contact" to "General" must see "General" in the table.
    const label = kindLabeller([{ slug: 'other', label: 'General' }, { slug: 'booking', label: 'Booking' }])
    expect(label('other')).toBe('General')
  })

  it('falls back to the readable slug for a kind that no longer exists', () => {
    const label = kindLabeller([{ slug: 'booking', label: 'Booking' }])
    expect(label('wedding-gig')).toBe('Wedding Gig')
  })
})

describe('toKindRows — the embedded select as the dashboard reads it', () => {
  const raw = (over = {}) => ({
    id: 'k1', slug: 'booking', label: 'Booking', sort_order: 0,
    enquiry_recipients: [
      { id: 'r-late', email: 'late@x.com', label: null, created_at: '2026-09-22T10:00:02Z' },
      { id: 'r-early', email: 'early@x.com', label: 'First', created_at: '2026-09-22T10:00:01Z' },
    ],
    ...over,
  })

  it('orders each list by created_at, the order the resolver addresses them in', () => {
    // What the manager sees must be the order the To: header will carry.
    expect(toKindRows([raw()])[0].recipients.map((r) => r.email)).toEqual(['early@x.com', 'late@x.com'])
  })

  it('breaks a created_at tie on id, so two rows inserted in one statement never swap', () => {
    const tied = raw({
      enquiry_recipients: [
        { id: 'b', email: 'b@x.com', label: null, created_at: '2026-09-22T10:00:00Z' },
        { id: 'a', email: 'a@x.com', label: null, created_at: '2026-09-22T10:00:00Z' },
      ],
    })
    expect(toKindRows([tied])[0].recipients.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('treats a missing child array as an empty list', () => {
    expect(toKindRows([raw({ enquiry_recipients: null })])[0].recipients).toEqual([])
    expect(toKindRows(null)).toEqual([])
  })

  it('maps sort_order to sortOrder and drops created_at from the rows it returns', () => {
    const [k] = toKindRows([raw({ sort_order: 3 })])
    expect(k.sortOrder).toBe(3)
    expect(k.recipients[0]).toEqual({ id: 'r-early', email: 'early@x.com', label: 'First' })
  })

  it('reads the description from the column, and a NULL one stays null (no line)', () => {
    // A manager who clears Booking's line must not get the fixed one back.
    expect(toKindRows([raw({ description: 'For gigs' })])[0].description).toBe('For gigs')
    expect(toKindRows([raw({ description: null })])[0].description).toBeNull()
  })

  it('falls back to the fixed line when the column is not there yet (before 20261002220000)', () => {
    // DELETE with kindGuide at push time.
    expect(toKindRows([raw()])[0].description).toBe('For shows, festivals and private events')
    expect(toKindRows([raw({ slug: 'press' })])[0].description).toBeNull()
  })
})

describe('recipientProblem — said BEFORE the save, in a sentence', () => {
  it('accepts an ordinary address', () => {
    expect(recipientProblem([], 'skeen@example.com')).toBeNull()
    expect(recipientProblem(['a@x.com'], '  mgr@x.com  ')).toBeNull()
  })

  it('refuses what is not an address', () => {
    for (const bad of ['bob', 'bob@', '@x.com', 'bob@x', 'two words@x.com', '']) {
      expect(recipientProblem([], bad), JSON.stringify(bad)).toMatch(/email address/)
    }
  })

  it('refuses an address carrying a pasted invisible character', () => {
    // A zero-width space passes the storage CHECK and pickRecipients alike — neither treats
    // U+200B as whitespace — and Resend then rejects the WHOLE send, primary included. The
    // dashboard is the one place a human can be told.
    expect(recipientProblem([], 'skeen\u200b@example.com')).toMatch(/email address/)
    expect(recipientProblem([], 'skeen@exam\u00a0ple.com')).toMatch(/email address/)
  })

  it('refuses a duplicate, whatever its case', () => {
    expect(recipientProblem(['Skeen@Example.com'], 'skeen@example.com')).toMatch(/already/)
  })

  it('refuses the eleventh', () => {
    const ten = Array.from({ length: RECIPIENT_CAP }, (_, i) => `p${i}@x.com`)
    expect(recipientProblem(ten, 'eleventh@x.com')).toMatch(/at most 10/)
    expect(recipientProblem(ten.slice(1), 'tenth@x.com')).toBeNull()
  })
})

describe('kindGuide — the line under a kind on Settings › Email', () => {
  it('says what each seeded kind is FOR', () => {
    expect(kindGuide('booking')).toBe('For shows, festivals and private events')
    expect(kindGuide('demo')).toBe('For music and demo submissions')
    expect(kindGuide('other')).toBe('For everything else')
  })

  it('says nothing for a kind the artist invented — no filler', () => {
    expect(kindGuide('press')).toBeNull()
    // A slug is the artist's text: one named like an Object.prototype key must not find
    // something on the prototype chain.
    expect(kindGuide('constructor')).toBeNull()
  })
})

describe('kindDetailsUpdate — a kind\'s name and description as the columns to write', () => {
  /**
   * `ek_description_clean` (20261002220000), copied here as the SPECIFICATION: whatever this
   * function lets through must satisfy it, or the save is a raw 23514 instead of a sentence.
   * JS `\s` is a superset of Postgres's, so passing this passes the CHECK.
   */
  const passesCheck = (d: string | null) =>
    d === null || ([...d].length >= 1 && [...d].length <= 120 && !/[\r\n\v\f\u0085\u2028\u2029]/.test(d) && !/^\s|\s$/.test(d))
  /** Every mandatory line break the CHECK refuses. */
  const BREAKS = ['\r', '\n', '\v', '\f', '\u0085', '\u2028', '\u2029']

  const update = (input: Parameters<typeof kindDetailsUpdate>[0]) => {
    const r = kindDetailsUpdate(input)
    if (!r.ok) throw new Error(`refused: ${r.error}`)
    return r.update
  }
  const refusal = (input: Parameters<typeof kindDetailsUpdate>[0]) => {
    const r = kindDetailsUpdate(input)
    return r.ok ? null : r.error
  }

  it('trims both and writes ONLY the fields given', () => {
    expect(update({ label: '  Press ', description: '  For radio and interviews  ' })).toEqual({ label: 'Press', description: 'For radio and interviews' })
    // A name-only save must not touch the description (it saves before the column exists).
    expect(update({ label: 'Press' })).toEqual({ label: 'Press' })
    expect(update({ description: 'For radio' })).toEqual({ description: 'For radio' })
  })

  it('stores an empty or blank description as null: "no line" has one spelling', () => {
    for (const d of ['', '   ', '\t', null]) expect(update({ description: d }), JSON.stringify(d)).toEqual({ description: null })
  })

  it('refuses a line break anywhere in the description, every kind of break', () => {
    for (const br of BREAKS) {
      expect(refusal({ description: `For shows${br}and festivals` }), JSON.stringify(br)).toMatch(/one line/)
    }
  })

  it('refuses a line break in the name too', () => {
    for (const br of BREAKS) expect(refusal({ label: `Book${br}ing` }), JSON.stringify(br)).toMatch(/one line/)
  })

  it('takes exactly DESCRIPTION_MAX characters, counted as Postgres counts them, and refuses one more', () => {
    expect(DESCRIPTION_MAX).toBe(120)
    expect(update({ description: 'x'.repeat(120) })).toEqual({ description: 'x'.repeat(120) })
    expect(refusal({ description: 'x'.repeat(121) })).toMatch(/120 characters/)
    // 120 emoji are 240 UTF-16 units but 120 characters to char_length: accepted, not cut.
    const emoji = '🎤'.repeat(120)
    expect(update({ description: emoji })).toEqual({ description: emoji })
    expect(refusal({ description: emoji + '🎤' })).toMatch(/120 characters/)
    // The limit is counted AFTER the trim: padding is not content.
    expect(update({ description: `  ${'x'.repeat(120)}  ` })).toEqual({ description: 'x'.repeat(120) })
  })

  it('refuses an empty name, and cuts a long one to LABEL_MAX as the rename always has', () => {
    expect(refusal({ label: '   ', description: 'For x' })).toMatch(/name/)
    expect(update({ label: 'y'.repeat(LABEL_MAX + 5) })).toEqual({ label: 'y'.repeat(LABEL_MAX) })
  })

  it('refuses an edit with nothing in it', () => {
    expect(refusal({})).toBeTruthy()
  })

  it('never returns a description the database CHECK would refuse', () => {
    const tricky = [' For x', 'For x ', '\u00a0For x\u00a0', '\uFEFFFor x', '\u2028For x', 'For x\n', '\tFor\tx', ' '.repeat(130) + 'x', 'x'.repeat(119) + ' y']
    for (const d of tricky) {
      const r = kindDetailsUpdate({ description: d })
      if (r.ok) expect(passesCheck(r.update.description ?? null), JSON.stringify(d)).toBe(true)
    }
  })
})
