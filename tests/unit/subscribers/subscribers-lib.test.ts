// The Subscribers tool's pure rules: search, sort, highlight, the CSV, the mailto link.
/**
 * SUBSCRIBERS (Sam, 2026-09-24; prototypes/subscribers_ledger_20260924.html). The page is a
 * read-only ledger of the emails the site's signup door collected. Everything it decides
 * that is not layout lives in src/lib/subscribers.ts, so it is pinned here without a DOM or
 * a database, and Stryker mutates it (stryker.config.json `mutate`).
 *
 * The sort cases are keyed by the SUBSCRIBER_SORTS registry (`Record<SubscriberSort, …>`),
 * so a new sort that nobody wrote an expectation for is a compile error, not a gap.
 */
import { describe, expect, it } from 'vitest'
import {
  CSV_HEADER,
  SUBSCRIBER_SORTS,
  csvCell,
  emailList,
  exportFilename,
  filterSubscribers,
  formatSubscribedDate,
  highlightSegments,
  mailtoHref,
  sortSubscribers,
  subscribedDay,
  subscribersCsv,
  type Subscriber,
  type SubscriberSort,
} from '@/lib/subscribers'

const ROWS: Subscriber[] = [
  { email: 'maya.chen@example.com', created_at: '2026-09-22T14:03:11.123456+00:00' },
  { email: 'Ben.Walsh@Example.com', created_at: '2026-07-09T08:00:00+00:00' },
  { email: 'theo.park@example.com', created_at: '2026-09-19T20:15:00.5+00:00' },
  { email: 'ava+news@example.com', created_at: '2026-08-11T00:00:00+00:00' },
]
const emails = (rows: readonly Subscriber[]) => rows.map((r) => r.email)

describe('filterSubscribers', () => {
  it('matches any part of the email, ignoring case, and keeps the given order', () => {
    expect(emails(filterSubscribers(ROWS, 'EXAMPLE.com'))).toEqual(emails(ROWS))
    expect(emails(filterSubscribers(ROWS, 'walsh'))).toEqual(['Ben.Walsh@Example.com'])
    expect(emails(filterSubscribers(ROWS, 'a.c'))).toEqual(['maya.chen@example.com'])
  })

  it('an empty or blank query shows everything; surrounding spaces are ignored', () => {
    expect(emails(filterSubscribers(ROWS, ''))).toEqual(emails(ROWS))
    expect(emails(filterSubscribers(ROWS, '   '))).toEqual(emails(ROWS))
    expect(emails(filterSubscribers(ROWS, '  theo  '))).toEqual(['theo.park@example.com'])
  })

  it('treats regex characters literally: "." is a dot and "+" is a plus', () => {
    // As a regex, "a.c" would also match "abc"; as text it must not.
    const rows = [
      { email: 'abc@x.io', created_at: '2026-01-01T00:00:00Z' },
      { email: 'a.c@x.io', created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(emails(filterSubscribers(rows, 'a.c'))).toEqual(['a.c@x.io'])
    expect(emails(filterSubscribers(ROWS, 'ava+news'))).toEqual(['ava+news@example.com'])
    expect(filterSubscribers(ROWS, '.*')).toEqual([])
  })

  it('no match is an empty list, not everything', () => {
    expect(filterSubscribers(ROWS, 'zzz')).toEqual([])
  })
})

describe('sortSubscribers', () => {
  const EXPECTED: Record<SubscriberSort, string[]> = {
    new: ['maya.chen@example.com', 'theo.park@example.com', 'ava+news@example.com', 'Ben.Walsh@Example.com'],
    old: ['Ben.Walsh@Example.com', 'ava+news@example.com', 'theo.park@example.com', 'maya.chen@example.com'],
    // Case-insensitive: "Ben" sorts between "ava" and "maya", not before every lowercase.
    az: ['ava+news@example.com', 'Ben.Walsh@Example.com', 'maya.chen@example.com', 'theo.park@example.com'],
  }

  it('the registry is exactly Newest · Oldest · A–Z, in that order', () => {
    expect(SUBSCRIBER_SORTS.map((s) => [s.key, s.label])).toEqual([
      ['new', 'Newest'],
      ['old', 'Oldest'],
      ['az', 'A–Z'],
    ])
  })

  for (const { key, label } of SUBSCRIBER_SORTS) {
    it(`${label} orders the list`, () => {
      expect(emails(sortSubscribers(ROWS, key))).toEqual(EXPECTED[key])
    })
  }

  it('does not reorder the array it was given', () => {
    const before = emails(ROWS)
    sortSubscribers(ROWS, 'az')
    sortSubscribers(ROWS, 'old')
    expect(emails(ROWS)).toEqual(before)
  })

  it('orders by the INSTANT, not the string: an offset and a fraction do not fool it', () => {
    // 11:00+02:00 is 09:00Z, an hour BEFORE 10:00Z, though it sorts after it as text.
    const rows = [
      { email: 'b@x.io', created_at: '2026-09-22T10:00:00+00:00' },
      { email: 'a@x.io', created_at: '2026-09-22T11:00:00+02:00' },
      { email: 'c@x.io', created_at: '2026-09-22T10:00:00.25+00:00' },
    ]
    expect(emails(sortSubscribers(rows, 'new'))).toEqual(['c@x.io', 'b@x.io', 'a@x.io'])
    expect(emails(sortSubscribers(rows, 'old'))).toEqual(['a@x.io', 'b@x.io', 'c@x.io'])
  })

  it('a tie on time falls back to the email, so the order never depends on the input', () => {
    const t = '2026-09-22T10:00:00+00:00'
    const rows = [
      { email: 'c@x.io', created_at: t },
      { email: 'A@x.io', created_at: t },
      { email: 'b@x.io', created_at: t },
    ]
    expect(emails(sortSubscribers(rows, 'new'))).toEqual(['A@x.io', 'b@x.io', 'c@x.io'])
    expect(emails(sortSubscribers(rows, 'old'))).toEqual(['A@x.io', 'b@x.io', 'c@x.io'])
    expect(emails(sortSubscribers([...rows].reverse(), 'new'))).toEqual(['A@x.io', 'b@x.io', 'c@x.io'])
  })

  it('A–Z breaks a same-letters tie by case, then newest first', () => {
    const rows = [
      { email: 'sam@x.io', created_at: '2026-01-01T00:00:00Z' },
      { email: 'Sam@x.io', created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(emails(sortSubscribers(rows, 'az'))).toEqual(['Sam@x.io', 'sam@x.io'])
  })
})

describe('highlightSegments', () => {
  const joined = (segs: { text: string }[]) => segs.map((s) => s.text).join('')

  it('no query: the whole email, unmarked', () => {
    expect(highlightSegments('maya@x.io', '')).toEqual([{ text: 'maya@x.io', hit: false }])
    expect(highlightSegments('maya@x.io', '   ')).toEqual([{ text: 'maya@x.io', hit: false }])
  })

  it('marks the match in the email’s OWN case, whatever case was typed', () => {
    expect(highlightSegments('Ben.Walsh@Example.com', 'WALSH')).toEqual([
      { text: 'Ben.', hit: false },
      { text: 'Walsh', hit: true },
      { text: '@Example.com', hit: false },
    ])
  })

  it('marks every occurrence, at the start and at the end too', () => {
    expect(highlightSegments('ana@ana', 'ana')).toEqual([
      { text: 'ana', hit: true },
      { text: '@', hit: false },
      { text: 'ana', hit: true },
    ])
    expect(highlightSegments('aaaa', 'aa')).toEqual([{ text: 'aa', hit: true }, { text: 'aa', hit: true }])
  })

  it('trims the query the way the filter does', () => {
    expect(highlightSegments('theo@x.io', ' theo ')).toEqual([
      { text: 'theo', hit: true },
      { text: '@x.io', hit: false },
    ])
  })

  it('regex characters are literal text', () => {
    for (const q of ['.', '+', '(', '*', '[', '\\', '$', '?', '|', '^']) {
      const email = `a${q}b@host` // no other dot, so "." has exactly one place to match
      const segs = highlightSegments(email, q)
      expect(segs.filter((s) => s.hit).map((s) => s.text), q).toEqual([q])
      expect(joined(segs)).toBe(email)
    }
    // "." must not match every character.
    expect(highlightSegments('abc', '.')).toEqual([{ text: 'abc', hit: false }])
  })

  it('HTML characters stay RAW TEXT in the segments; React escapes them at render', () => {
    const segs = highlightSegments('<img src=x onerror=alert(1)>@x.io', '<img')
    expect(segs[0]).toEqual({ text: '<img', hit: true })
    expect(joined(segs)).toBe('<img src=x onerror=alert(1)>@x.io')
    expect(joined(segs)).not.toContain('&lt;')
  })

  it('a query longer than the email, or absent from it, marks nothing', () => {
    expect(highlightSegments('a@b.c', 'a@b.com')).toEqual([{ text: 'a@b.c', hit: false }])
    expect(highlightSegments('a@b.c', 'zz')).toEqual([{ text: 'a@b.c', hit: false }])
  })
})

describe('dates', () => {
  it('shows "Sep 22, 2026", in UTC so server and browser agree', () => {
    expect(formatSubscribedDate('2026-09-22T14:03:11.123456+00:00')).toBe('Sep 22, 2026')
    // 23:30 at -05:00 is already the 23rd in UTC.
    expect(formatSubscribedDate('2026-09-22T23:30:00-05:00')).toBe('Sep 23, 2026')
  })

  it('the CSV day is ISO YYYY-MM-DD, in UTC', () => {
    expect(subscribedDay('2026-09-22T14:03:11.123456+00:00')).toBe('2026-09-22')
    expect(subscribedDay('2026-09-22T23:30:00-05:00')).toBe('2026-09-23')
    expect(subscribedDay('2026-01-05T00:00:00+00:00')).toBe('2026-01-05')
  })
})

describe('csvCell', () => {
  it('leaves a plain email alone', () => {
    expect(csvCell('maya@x.io')).toBe('maya@x.io')
    // An "=" INSIDE the value is harmless; only a leading one starts a formula.
    expect(csvCell('a=b@x.io')).toBe('a=b@x.io')
  })

  it('quotes a comma, a quote, a newline or a carriage return, doubling inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('a\rb')).toBe('"a\rb"')
  })

  it('CRITICAL: a cell a spreadsheet would run as a formula gets a leading apostrophe', () => {
    // = + - @ tab CR: the OWASP CSV-injection starters. "-x@y.io" is a VALID email.
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('+1@x.io')).toBe("'+1@x.io")
    expect(csvCell('-x@y.io')).toBe("'-x@y.io")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tcmd@x.io')).toBe("'\tcmd@x.io")
    // Guarded AND quoted: the CR also needs quotes.
    expect(csvCell('\rcmd@x.io')).toBe(`"'\rcmd@x.io"`)
    // Guarded, then quoted for the comma: the apostrophe sits INSIDE the quotes.
    expect(csvCell('=1,2')).toBe(`"'=1,2"`)
  })
})

describe('subscribersCsv', () => {
  it('a header, then one line per subscriber, NEWEST first, CRLF-terminated', () => {
    expect(CSV_HEADER).toBe('email,subscribed_at')
    expect(subscribersCsv(ROWS)).toBe(
      [
        'email,subscribed_at',
        'maya.chen@example.com,2026-09-22',
        'theo.park@example.com,2026-09-19',
        'ava+news@example.com,2026-08-11',
        'Ben.Walsh@Example.com,2026-07-09',
      ].join('\r\n') + '\r\n',
    )
  })

  it('escapes and guards every cell', () => {
    const csv = subscribersCsv([{ email: '=cmd|"/c calc"!A0,x@y.io', created_at: '2026-09-22T00:00:00Z' }])
    expect(csv.split('\r\n')[1]).toBe(`"'=cmd|""/c calc""!A0,x@y.io",2026-09-22`)
  })

  it('no subscribers: the header alone', () => {
    expect(subscribersCsv([])).toBe('email,subscribed_at\r\n')
  })
})

describe('exportFilename', () => {
  const NOW = Date.parse('2026-09-24T23:59:59Z')

  it('<artist-slug>-subscribers-<YYYY-MM-DD>.csv, dated in UTC', () => {
    expect(exportFilename('lone-pine', NOW)).toBe('lone-pine-subscribers-2026-09-24.csv')
  })

  it('a hostile slug cannot break out of the header: only [a-z0-9-] survive', () => {
    const name = exportFilename('../"Evil"\r\nSet-Cookie: x', NOW)
    expect(name).toMatch(/^[a-z0-9-]+-subscribers-2026-09-24\.csv$/)
    expect(name).toBe('evil-set-cookie-x-subscribers-2026-09-24.csv')
  })

  it('an empty slug still names the file', () => {
    expect(exportFilename('', NOW)).toBe('artist-subscribers-2026-09-24.csv')
    expect(exportFilename('---', NOW)).toBe('artist-subscribers-2026-09-24.csv')
  })
})

describe('mailtoHref', () => {
  it('a plain address keeps its @', () => {
    expect(mailtoHref('maya@example.com')).toBe('mailto:maya@example.com')
  })

  it('CRITICAL: URL-encodes the address, so a crafted email cannot add a cc or a body', () => {
    // subscribe() allows any non-space, non-@ characters, so "?" and "&" can reach here.
    expect(mailtoHref('x?cc=boss@evil.io')).toBe('mailto:x%3Fcc%3Dboss@evil.io')
    expect(mailtoHref('a&body=hi#frag@x.io')).toBe('mailto:a%26body%3Dhi%23frag@x.io')
    expect(mailtoHref('ava+news@example.com')).toBe('mailto:ava%2Bnews@example.com')
    expect(mailtoHref('50%@x.io')).toBe('mailto:50%25@x.io')
  })

  it('encodes the domain too', () => {
    expect(mailtoHref('a@x.io?subject=hi')).toBe('mailto:a@x.io%3Fsubject%3Dhi')
  })
})

describe('emailList', () => {
  it('joins the given rows, in order, as "a, b" for a BCC field', () => {
    expect(emailList(ROWS.slice(0, 2))).toBe('maya.chen@example.com, Ben.Walsh@Example.com')
    expect(emailList([])).toBe('')
  })
})
