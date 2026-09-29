/**
 * A fake DNS for the net-guard tests: no network. A name maps to its addresses, an Error to
 * throw, or a function of how many times THIS name has been asked (for rebinding: public the
 * first time, private the next). An unknown name is ENOTFOUND, like getaddrinfo.
 */
import net from 'node:net'
import type { Resolver } from '@/lib/net-guard'

export type FakeDns = Resolver & { calls: string[] }

export function fakeDns(map: Record<string, string[] | Error | ((n: number) => string[])>): FakeDns {
  const calls: string[] = []
  const r = (async (host: string) => {
    calls.push(host)
    const v = map[host]
    if (v === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    if (v instanceof Error) throw v
    const list = typeof v === 'function' ? v(calls.filter((c) => c === host).length) : v
    return list.map((address) => ({ address, family: net.isIP(address) }))
  }) as unknown as FakeDns
  r.calls = calls
  return r
}
