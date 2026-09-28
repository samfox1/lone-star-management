/**
 * ONE integration file at a time on this machine — across every vitest process, not just
 * inside one.
 *
 * WHY. `fileParallelism: false` (vitest.config.ts) keeps the files of ONE run from
 * interleaving, because they share one hosted database: the two seed artists, the
 * `mail_settings` default recipient, and the analytics roll-up / prune jobs, which are
 * global by nature and cannot be scoped to a throwaway artist. It says nothing about a
 * SECOND run. With several agents on one checkout that is the normal case — the full
 * suite runs while a builder runs its own folder — and the files then race exactly the
 * way the setting exists to prevent. Measured 2026-09-28 with two `vitest run
 * tests/integration` at once, the plain (unshuffled) run failed on the other's writes:
 *
 *   enquiry-door  expected to_email "fallback-desk@example.com",
 *                 got "recipients-fallback@example.com"
 *
 * — the global default recipient that enquiry-recipients.test.ts had just set in the
 * other process. Each file is green alone. This lock turns "sequential inside a run" into
 * "sequential on the machine", the assumption every integration file was written under.
 *
 * HOW. The holder is whoever creates the lock DIRECTORY (`mkdir` is atomic). Waiters take
 * turns in arrival order: each drops a ticket in `queue/` and only the oldest live ticket
 * may try the lock, so a run that just finished a file cannot grab the next turn ahead of
 * a run that has been waiting. A holder or ticket whose process is gone (a killed run) is
 * cleared by the next waiter, so a crash never wedges the suite.
 *
 * SCOPE. Integration files only (the tests/ folder rule: `tests/integration/` is what
 * talks to the hosted project). Unit and component files never wait. The lock lives in
 * the OS temp dir, keyed by the Supabase URL: one lock per database, shared by every
 * checkout and worktree on this machine. It cannot see another machine — nothing else
 * runs this suite today.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

/** Per-database scratch dir shared by every test process on this machine. */
export function testStateDir(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'no-supabase-url'
  const key = createHash('sha256').update(url).digest('hex').slice(0, 12)
  const dir = join(tmpdir(), `lone-star-tests-${key}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** The folder rule, as a predicate over a test file's absolute path. */
export function isIntegrationFile(filepath: string | undefined): boolean {
  return !!filepath && filepath.includes(`${sep}tests${sep}integration${sep}`)
}

type Stamp = { pid: number; token: string; file: string; at: number }

const POLL_MS = 150
/** Longest integration file on record is ~45s (brand-page). A holder past this is wedged. */
const MAX_HOLD_MS = 10 * 60_000
/** A lock dir with no owner file yet is mid-creation; past this it was abandoned. */
const OWNERLESS_GRACE_MS = 10_000

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readStamp(path: string): Stamp | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Stamp
  } catch {
    return null
  }
}

const live = (s: Stamp | null, now: number, maxAge: number) =>
  !!s && alive(s.pid) && now - s.at < maxAge

/** True when no older live ticket is waiting. Clears dead tickets on the way past. */
function firstInLine(queue: string, mine: string, maxWait: number): boolean {
  const now = Date.now()
  for (const name of readdirSync(queue).sort()) {
    if (name >= mine) return true
    const path = join(queue, name)
    if (live(readStamp(path), now, maxWait)) return false
    rmSync(path, { force: true })
  }
  return true
}

/** Remove the lock if its holder is gone. Returns the live holder, if any, for messages. */
function clearIfStale(lock: string): Stamp | null {
  const owner = readStamp(join(lock, 'owner.json'))
  const now = Date.now()
  if (live(owner, now, MAX_HOLD_MS)) return owner
  if (!owner) {
    let age = 0
    try {
      age = now - statSync(lock).mtimeMs
    } catch {
      return null // already gone
    }
    if (age < OWNERLESS_GRACE_MS) return null
  }
  // Re-read right before removing, so a lock that changed hands meanwhile is left alone.
  const again = readStamp(join(lock, 'owner.json'))
  if ((again?.token ?? null) === (owner?.token ?? null)) rmSync(lock, { recursive: true, force: true })
  return null
}

function tryTake(lock: string, me: Stamp): boolean {
  try {
    mkdirSync(lock)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
  // `at` restarts here: MAX_HOLD_MS measures holding, not the wait before it.
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ ...me, at: Date.now() }))
  return true
}

/**
 * Wait for this machine's integration turn; resolves to the release function.
 * `dir` is for the lock's own unit test — real callers use the shared state dir.
 */
export async function acquireDbLock(
  file: string,
  opts: { dir?: string; maxWaitMs?: number } = {},
): Promise<() => void> {
  const dir = opts.dir ?? testStateDir()
  const maxWait = opts.maxWaitMs ?? 8 * 60_000
  const lock = join(dir, 'db.lock')
  const queue = join(dir, 'queue')
  mkdirSync(queue, { recursive: true })

  const me: Stamp = { pid: process.pid, token: randomUUID(), file, at: Date.now() }
  const ticketName = `${String(me.at).padStart(15, '0')}-${me.token}.json`
  const ticket = join(queue, ticketName)
  writeFileSync(ticket, JSON.stringify(me))
  try {
    for (;;) {
      if (firstInLine(queue, ticketName, maxWait) && tryTake(lock, me)) {
        return () => {
          const owner = readStamp(join(lock, 'owner.json'))
          if (owner?.token === me.token) rmSync(lock, { recursive: true, force: true })
        }
      }
      const holder = clearIfStale(lock)
      if (Date.now() - me.at > maxWait) {
        throw new Error(
          `waited ${Math.round(maxWait / 1000)}s for the integration DB lock (${lock}); ` +
            `held by pid ${holder?.pid ?? '?'} running ${holder?.file ?? '?'}. ` +
            'Another vitest process is running integration files on this machine.',
        )
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  } finally {
    rmSync(ticket, { force: true })
  }
}
