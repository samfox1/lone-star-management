/**
 * A PostgREST-shaped fake for the Brand page's DB-free tests.
 *
 * Every builder call is recorded as one `Call`, and a test-supplied `respond` decides what
 * each awaited chain returns. One rule is enforced here rather than left to each test,
 * because it is the rule the code under test most often gets wrong (AGENTS.md rule 3): a
 * WRITE returns rows only when `.select()` was chained onto it. Real PostgREST does the
 * same, so code that forgets `.select` sees `data: null` and must not read it as success.
 *
 * Not a test file (no `.test.ts`), so vitest never runs it on its own.
 */
export type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'

export type Call = {
  table: string
  op: Op
  payload?: unknown
  /** Every filter, as [method, column, value]: ['eq', 'id', 'm1'], ['in', 'purpose', [...]]. */
  filters: [string, string, unknown][]
  /** Whether `.select()` was chained (for a write: whether rows come back). */
  selected: boolean
  cols?: string
  terminal?: 'single' | 'maybeSingle'
  args?: unknown
  /** An upsert's second argument (`{ onConflict }`). */
  options?: unknown
}

export type Reply = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null }

export const WRITES: readonly Op[] = ['insert', 'update', 'delete', 'upsert', 'rpc']

/** The value a filter was given, or undefined. */
export function filterValue(call: Call, col: string, method = 'eq'): unknown {
  return call.filters.find(([m, c]) => m === method && c === col)?.[2]
}

export function fakeClient(respond: (call: Call) => Reply = () => ({ data: [] })) {
  const calls: Call[] = []
  const removed: string[] = []

  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [], selected: false }
    let opSet = false
    const setOp = (op: Op, payload?: unknown) => {
      call.op = op
      call.payload = payload
      opSet = true
      return chain
    }
    const chain: Record<string, unknown> = {
      select: (cols?: string) => {
        if (!opSet) call.op = 'select'
        call.selected = true
        call.cols = cols
        return chain
      },
      insert: (p: unknown) => setOp('insert', p),
      update: (p: unknown) => setOp('update', p),
      delete: () => setOp('delete'),
      upsert: (p: unknown, options?: unknown) => ((call.options = options), setOp('upsert', p)),
      single: () => ((call.terminal = 'single'), chain),
      maybeSingle: () => ((call.terminal = 'maybeSingle'), chain),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        calls.push(call)
        const reply = respond(call)
        const isWrite = call.op !== 'select'
        const data = isWrite && !call.selected ? null : (reply.data ?? null)
        return Promise.resolve({ data, error: reply.error ?? null, count: reply.count ?? null }).then(ok, bad)
      },
    }
    for (const m of ['eq', 'neq', 'in', 'is', 'order', 'limit', 'match']) {
      chain[m] = (col: string, value?: unknown) => {
        call.filters.push([m, col, value])
        return chain
      }
    }
    return chain
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => {
      const call: Call = { table: name, op: 'rpc', filters: [], selected: true, args }
      return {
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          calls.push(call)
          const reply = respond(call)
          return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null }).then(ok, bad)
        },
      }
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removed.push(...paths)
          return Promise.resolve({ error: null })
        },
        list: () => Promise.resolve({ data: [] }),
      }),
    },
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    calls,
    removed,
    /** Every call that could change the database. */
    writes: () => calls.filter((c) => c.op !== 'select'),
  }
}

/** The ownership read `callerOwns` makes: `artists` select id … maybeSingle. */
export const isOwnershipRead = (c: Call) =>
  c.table === 'artists' && c.op === 'select' && c.cols === 'id' && c.terminal === 'maybeSingle'
