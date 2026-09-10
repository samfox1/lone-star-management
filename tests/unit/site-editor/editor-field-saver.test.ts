// Saves for one field run in order, so an older write cannot land after a newer one.
/**
 * runSerialized — the inspector tools' per-field save runner (review #6 + #8). Saves for
 * the SAME field are chained so an older write can't land after a newer one; an `errored`
 * set makes a field's failure survive another field's later success (no masked error).
 */
import { describe, expect, it } from 'vitest'
import { runSerialized } from '@/app/artists/[id]/(dashboard)/editor/inspector-shared'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('runSerialized', () => {
  it('does not mask a field error with another field’s later success (#8)', async () => {
    const saving = { current: new Map<string, Promise<unknown>>() }
    const errored = { current: new Set<string>() }
    const statuses: string[] = []
    const setStatus = (s: string) => statuses.push(s)

    runSerialized(saving, errored, setStatus, 'A', async () => ({ error: 'boom' }))
    await tick()
    expect(statuses.at(-1)).toBe('error')

    runSerialized(saving, errored, setStatus, 'B', async () => ({})) // other field succeeds
    await tick()
    expect(statuses.at(-1)).toBe('error') // A's failure is NOT masked

    runSerialized(saving, errored, setStatus, 'A', async () => ({})) // A now saves
    await tick()
    expect(statuses.at(-1)).toBe('saved') // cleared
  })

  it('a THROWN action ends on "error", not a permanent "saving…"', async () => {
    // A server action that rejects (network drop, an uncaught server throw) is not the
    // same as one that resolves `{ error }`. If only the resolved shape is handled the
    // status callback never fires, the field is stuck on "Saving…" forever, and the
    // rejection is unhandled.
    const saving = { current: new Map<string, Promise<unknown>>() }
    const errored = { current: new Set<string>() }
    const statuses: string[] = []

    runSerialized(saving, errored, (s) => statuses.push(s), 'A', async () => {
      throw new Error('network down')
    })
    await tick()

    expect(statuses.at(-1)).toBe('error')
    expect(errored.current.has('A')).toBe(true)
  })

  it('a throw in one field is not masked by another field’s later success', async () => {
    const saving = { current: new Map<string, Promise<unknown>>() }
    const errored = { current: new Set<string>() }
    const statuses: string[] = []
    const setStatus = (s: string) => statuses.push(s)

    runSerialized(saving, errored, setStatus, 'A', async () => {
      throw new Error('network down')
    })
    await tick()
    runSerialized(saving, errored, setStatus, 'B', async () => ({}))
    await tick()
    expect(statuses.at(-1)).toBe('error')

    runSerialized(saving, errored, setStatus, 'A', async () => ({}))
    await tick()
    expect(statuses.at(-1)).toBe('saved')
  })

  it('a throw does not wedge the NEXT save of the same field', async () => {
    // The chain hangs off the stored promise; if a rejection isn't absorbed the next
    // save of that field never runs at all.
    const saving = { current: new Map<string, Promise<unknown>>() }
    const errored = { current: new Set<string>() }
    const ran: string[] = []

    runSerialized(saving, errored, () => {}, 'A', async () => {
      throw new Error('boom')
    })
    runSerialized(saving, errored, () => {}, 'A', async () => {
      ran.push('second')
    })
    await tick()
    expect(ran).toEqual(['second'])
  })

  it('chains a second save for the same field behind the first (#6)', async () => {
    const saving = { current: new Map<string, Promise<unknown>>() }
    const errored = { current: new Set<string>() }
    const order: string[] = []
    let release1: () => void = () => {}

    runSerialized(saving, errored, () => {}, 'A', () => new Promise<void>((r) => (release1 = () => (order.push('a1'), r()))))
    runSerialized(saving, errored, () => {}, 'A', async () => {
      order.push('a2')
    })

    await tick()
    expect(order).toEqual([]) // a2 must wait for a1 to settle
    release1()
    await tick()
    expect(order).toEqual(['a1', 'a2']) // in order
  })
})
