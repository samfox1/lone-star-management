// No test may write the live mail_settings row. This reads every test file and says so.
/**
 * `mail_settings` is LIVE config: the sender every enquiry goes out from. Tests run against
 * the hosted project (there is no test database), so a test that writes this row changes
 * real mail for as long as it runs — and for good if it crashes before its restore.
 *
 * That happened. enquiry-door and enquiry-recipients overwrote the row for their whole run,
 * three tests deleted it, and enquiries.isolation inserted a fake one whenever it found none.
 * Watched live on 2026-09-28 19:41–19:48 UTC: the real row replaced by
 * `fallback-desk@example.com`, then gone, then `isolation-probe@example.com`, then gone —
 * during an ordinary integration run. Snapshot-and-restore cannot be made safe (a crash
 * skips the restore; two runs nest and restore each other's fake value), so the rule is
 * simply: tests READ it, never write it. A test that needs "no sender" scopes its own
 * throwaway artist off the house row (`artist_mail_settings.use_house_mail = false`).
 *
 * Reading source is crude, and that is the point: this is the only check that runs before
 * a bad test ever reaches the database.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** This file quotes the forbidden shapes as fixtures, so the scan skips it. */
const SELF = fileURLToPath(import.meta.url)

/** A supabase-js write on the table itself (never `artist_mail_settings`), across newlines. */
const CLIENT_WRITE = /\.from\(\s*['"`]mail_settings['"`]\s*\)\s*\.\s*(insert|upsert|update|delete)\s*\(/g
/** The same in raw SQL, should a test ever grow some. */
const SQL_WRITE = /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?)\s+(public\.)?mail_settings\b/gi

/** Every write to the live row in this source text, as `line: text`. */
function liveMailWrites(source: string): string[] {
  const hits: string[] = []
  for (const re of [CLIENT_WRITE, SQL_WRITE]) {
    for (const m of source.matchAll(re)) {
      const line = source.slice(0, m.index).split('\n').length
      hits.push(`${line}: ${m[0].replace(/\s+/g, ' ')}`)
    }
  }
  return hits
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : testFiles(path)
    return /\.(ts|tsx|js|mjs|sql)$/.test(name) ? [path] : []
  })
}

describe('the scanner', () => {
  // The shapes the suites actually used before 2026-09-28, verbatim, so the scan below is
  // known to catch what it exists for.
  it.each([
    [`await svc.from('mail_settings').upsert({ id: true, default_to_email: DEFAULT_TO })`],
    [`await svc.from('mail_settings').delete().eq('id', true)`],
    [`await svc.from('mail_settings').insert({\n  default_to_email: 'x@example.com' })`],
    [`await svc\n    .from('mail_settings')\n    .update({ sending_domain: 'x.example' })`],
    [`delete from public.mail_settings where id`],
  ])('flags a write: %s', (src) => {
    expect(liveMailWrites(src)).toHaveLength(1)
  })

  it.each([
    [`await svc.from('mail_settings').select('sending_domain').maybeSingle()`],
    [`await svc.from('artist_mail_settings').upsert({ artist_id, use_house_mail: false })`],
    [`await svc.from('artist_mail_settings').delete().eq('artist_id', a)`],
    [`// the old test called svc.from('mail_settings') to read it`],
  ])('leaves a read, or the per-artist table, alone: %s', (src) => {
    expect(liveMailWrites(src)).toEqual([])
  })
})

describe('no test writes the live mail_settings row', () => {
  it('CRITICAL: finds no write in any file under tests/', () => {
    const root = join(process.cwd(), 'tests')
    const files = testFiles(root).filter((f) => f !== SELF)
    // A scan that reads nothing passes vacuously: prove it saw the enquiry suites.
    expect(files.some((f) => f.endsWith('enquiry-door.test.ts'))).toBe(true)
    const offenders = files.flatMap((file) =>
      liveMailWrites(readFileSync(file, 'utf8')).map((hit) => `${relative(process.cwd(), file)}:${hit}`),
    )
    expect(offenders, 'a test writes the LIVE house mail row; scope a throwaway artist instead').toEqual([])
  })
})
