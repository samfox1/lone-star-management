// The machine-wide integration lock: one holder at a time, turns in arrival order, and a
//   dead holder never wedges the suite.
/**
 * `tests/helpers/db-lock.ts` is what keeps two vitest processes from running integration
 * files against the hosted database at the same moment (why: the header of that file).
 * Every case runs on a private temp dir, never the shared one, so this file cannot block
 * or be blocked by a real run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDbLock, isIntegrationFile } from '@tests/helpers/db-lock'

let dir: string
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'db-lock-test-')))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A pid no process holds: above macOS's and Linux's default pid ceilings. */
const DEAD_PID = 4_000_000

const settled = async (p: Promise<unknown>, ms = 400) =>
  Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))])

describe('acquireDbLock', () => {
  it('CRITICAL: a second holder waits until the first releases', async () => {
    fresh()
    const releaseA = await acquireDbLock('a', { dir })
    const b = acquireDbLock('b', { dir })
    expect(await settled(b), 'b got the lock while a still held it').toBe(false)
    releaseA()
    expect(await settled(b, 2000), 'b never got the lock after a released').toBe(true)
    ;(await b)()
  })

  it('CRITICAL: a run that just finished a file cannot take the next turn from one already waiting', async () => {
    // The starvation case. Run A releases and asks again at once (its next file); run B
    // has been waiting. Without the queue A's fresh request wins every time — it tries
    // the lock the instant it is free, B only on its next poll — and B never runs.
    fresh()
    const order: string[] = []
    const releaseA = await acquireDbLock('A file 1', { dir })
    const b = acquireDbLock('B file 1', { dir }).then((release) => {
      order.push('B')
      release()
    })
    await new Promise((r) => setTimeout(r, 30)) // B is now a ticket in the queue
    releaseA()
    const releaseA2 = await acquireDbLock('A file 2', { dir })
    order.push('A2')
    releaseA2()
    await b
    expect(order).toEqual(['B', 'A2'])
  })

  it('a holder whose process is gone is cleared, so a killed run never wedges the suite', async () => {
    fresh()
    mkdirSync(join(dir, 'db.lock'))
    writeFileSync(
      join(dir, 'db.lock', 'owner.json'),
      JSON.stringify({ pid: DEAD_PID, token: 'dead', file: 'killed.test.ts', at: Date.now() }),
    )
    const p = acquireDbLock('next', { dir })
    expect(await settled(p, 2000), 'a dead holder blocked the lock').toBe(true)
    ;(await p)()
  })

  it('a ticket left by a dead waiter does not hold up the queue', async () => {
    fresh()
    mkdirSync(join(dir, 'queue'))
    writeFileSync(
      join(dir, 'queue', `${'1'.padStart(15, '0')}-dead.json`),
      JSON.stringify({ pid: DEAD_PID, token: 'dead', file: 'killed.test.ts', at: 1 }),
    )
    const p = acquireDbLock('next', { dir })
    expect(await settled(p, 2000), 'a dead ticket blocked the queue').toBe(true)
    ;(await p)()
  })

  it('release only frees the lock it took', async () => {
    fresh()
    const releaseA = await acquireDbLock('a', { dir })
    releaseA()
    const releaseB = await acquireDbLock('b', { dir })
    releaseA() // stale release from a finished file: must not free b's lock
    const c = acquireDbLock('c', { dir })
    expect(await settled(c), "a's second release freed b's lock").toBe(false)
    releaseB()
    ;(await c)()
  })

  it('gives up with a message naming the holder instead of hanging', async () => {
    fresh()
    const release = await acquireDbLock('tests/integration/slow.test.ts', { dir })
    await expect(acquireDbLock('waiter', { dir, maxWaitMs: 300 })).rejects.toThrow(
      /integration DB lock.*held by pid \d+ running tests\/integration\/slow\.test\.ts/,
    )
    release()
  })
})

describe('isIntegrationFile', () => {
  it('is the tests/ folder rule: only tests/integration/ waits for the lock', () => {
    expect(isIntegrationFile('/repo/tests/integration/site/content.crud.test.ts')).toBe(true)
    expect(isIntegrationFile('/repo/tests/unit/harness/db-lock.test.ts')).toBe(false)
    expect(isIntegrationFile('/repo/tests/components/editor/x.test.tsx')).toBe(false)
    expect(isIntegrationFile('/repo/src/lib/integration/x.test.ts')).toBe(false)
    expect(isIntegrationFile(undefined)).toBe(false)
  })
})
