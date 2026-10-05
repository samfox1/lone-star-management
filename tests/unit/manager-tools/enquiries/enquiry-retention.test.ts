// How long an enquiry is kept, and the note the inbox shows about it.
/**
 * Code:     src/lib/enquiries/retention.ts (deleteAt, deletionNote)
 * Mirror:   public.enquiry_delete_at in supabase/migrations/20261005120000_enquiry_retention.sql,
 *           which the nightly prune_enquiries() deletes by. The two were compared case by case
 *           on a throwaway local Postgres (2026-10-05); the hosted half is
 *           tests/integration/enquiries/enquiry-retention.test.ts.
 * Tier:     STRICT (AGENTS.md "Test depth"): this is the rule that decides when a message is
 *           deleted for good, and the note is what tells a manager how long they have.
 * Covers:   • emailed (status sent) → 30 days; every other status → 90 (statuses read from
 *             the migration that defines them, not hand-listed)
 *           • the note on both sides of every day boundary, and never MORE time than is left
 *           • the same instant written with different offsets, and exact 24-hour days across a
 *             daylight-saving change in the runtime's own zone
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAt, deletionNote } from '@/lib/enquiries/retention'

const DAY = 24 * 60 * 60 * 1000
const AT = '2026-09-01T12:00:00.000Z'
const at = Date.parse(AT)

/** Every status the database allows, read from the LATEST migration that sets the CHECK —
 *  so a status added later is covered here without anyone remembering to list it. */
function dbStatuses(): string[] {
  const dir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let last: string[] | null = null
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
    const m = /enquiries_status_check\s+check\s*\(\s*status\s+in\s*\(([^)]*)\)/i.exec(sql)
    if (m) last = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  if (!last) throw new Error('no migration defines enquiries_status_check')
  return last
}

describe('deleteAt — how long each enquiry is kept', () => {
  it('CRITICAL: an emailed enquiry is kept 30 days', () => {
    expect(deleteAt('sent', AT)?.getTime()).toBe(at + 30 * DAY)
  })

  it('CRITICAL: every status that is NOT sent is kept 90 days — the dashboard is its only copy', () => {
    const statuses = dbStatuses()
    // The rule keys on this exact word; if the database ever renamed it, every enquiry
    // would quietly fall to 90 days here while the SQL disagreed.
    expect(statuses).toContain('sent')
    const notSent = statuses.filter((s) => s !== 'sent')
    expect(notSent.length).toBeGreaterThan(0)
    for (const s of notSent) expect(deleteAt(s, AT)?.getTime(), s).toBe(at + 90 * DAY)
  })

  it('an unknown or missing status is kept the LONGER time, never the shorter', () => {
    for (const s of ['', 'Sent', 'bounced', null, undefined]) {
      expect(deleteAt(s, AT)?.getTime(), String(s)).toBe(at + 90 * DAY)
    }
  })

  it('a date it cannot read gives no answer rather than a wrong one', () => {
    expect(deleteAt('sent', 'not a date')).toBeNull()
    expect(deletionNote('sent', 'not a date', at)).toBeNull()
  })
})

describe('deletionNote — what the inbox says', () => {
  const end = at + 30 * DAY // a sent enquiry received at AT goes then

  it('a fresh enquiry: the whole window', () => {
    expect(deletionNote('sent', AT, at)).toBe('deleted in 30 days')
    expect(deletionNote('unroutable', AT, at)).toBe('deleted in 90 days')
  })

  it('CRITICAL: never promises more time than is left — a minute in, it is 29 days', () => {
    // Rounding up would say "30 days" with 29 days and 23 hours left. Saying less is safe;
    // saying more is how a manager loses a message they thought they still had.
    expect(deletionNote('sent', AT, at + 60_000)).toBe('deleted in 29 days')
  })

  it('both sides of "in 2 days"', () => {
    expect(deletionNote('sent', AT, end - 2 * DAY)).toBe('deleted in 2 days')
    expect(deletionNote('sent', AT, end - 2 * DAY + 1)).toBe('deleted tomorrow')
  })

  it('both sides of "tomorrow"', () => {
    expect(deletionNote('sent', AT, end - DAY)).toBe('deleted tomorrow')
    expect(deletionNote('sent', AT, end - DAY + 1)).toBe('deleted today')
  })

  it('the last moment and after: today, never a negative count', () => {
    expect(deletionNote('sent', AT, end - 1)).toBe('deleted today')
    expect(deletionNote('sent', AT, end)).toBe('deleted today')
    expect(deletionNote('sent', AT, end + 5 * DAY)).toBe('deleted today')
  })

  it('CRITICAL: across the whole window, the days it names are never more than are left', () => {
    for (const status of ['sent', 'failed']) {
      const goes = deleteAt(status, AT)!.getTime()
      for (let now = at; now <= goes + DAY; now += 7 * 60 * 60 * 1000 + 13 * 60 * 1000) {
        const note = deletionNote(status, AT, now)!
        const named = note === 'deleted today' ? 0 : note === 'deleted tomorrow' ? 1 : Number(/in (\d+) days/.exec(note)![1])
        expect(named * DAY, `${status} at +${(now - at) / DAY} days: "${note}"`).toBeLessThanOrEqual(Math.max(0, goes - now))
      }
    }
  })
})

describe('time zones', () => {
  it('the same instant written with different offsets gives the same answer', () => {
    // Supabase hands back "+00:00"; a browser or a test might write Z or a local offset.
    const forms = ['2026-09-01T12:00:00Z', '2026-09-01T12:00:00+00:00', '2026-09-01T07:00:00-05:00', '2026-09-01T22:00:00+10:00']
    for (const f of forms) {
      expect(deleteAt('sent', f)?.toISOString(), f).toBe('2026-10-01T12:00:00.000Z')
      expect(deletionNote('sent', f, Date.parse('2026-09-20T12:00:00Z')), f).toBe('deleted in 11 days')
    }
  })

  describe('a daylight-saving change inside the window', () => {
    // The SQL counts 720 and 2160 HOURS, not '30 days': Postgres adds a day-interval in
    // calendar days of the session's zone, which is 23 or 25 hours across a change. These
    // run in a zone that changes (Chicago leaves daylight time on 2026-11-01), so a
    // calendar-day version of the rule here would land an hour off.
    let saved: string | undefined
    beforeAll(() => {
      saved = process.env.TZ
      process.env.TZ = 'America/Chicago'
    })
    afterAll(() => {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    })

    it('CRITICAL: 30 days is exactly 720 hours, even across the change', () => {
      // Guard on the guard: if the runtime ignored TZ, this test could not tell the two apart.
      expect(new Date('2026-10-20T12:00:00Z').getTimezoneOffset()).not.toBe(new Date('2026-11-20T12:00:00Z').getTimezoneOffset())
      expect(deleteAt('sent', '2026-10-20T12:00:00Z')?.toISOString()).toBe('2026-11-19T12:00:00.000Z')
      expect(deleteAt('failed', '2026-09-20T12:00:00Z')?.toISOString()).toBe('2026-12-19T12:00:00.000Z')
    })

    it('the day count does not slip by the hour the clocks moved', () => {
      // 23h59m before the end, on the far side of the change: still "today", not "tomorrow".
      expect(deletionNote('sent', '2026-10-20T12:00:00Z', Date.parse('2026-11-18T12:01:00Z'))).toBe('deleted today')
      expect(deletionNote('sent', '2026-10-20T12:00:00Z', Date.parse('2026-11-18T12:00:00Z'))).toBe('deleted tomorrow')
    })
  })
})
