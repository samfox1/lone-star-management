// The map's server modules reach the city list; a client component that reaches one ships it to the
// browser. It happened once (two size constants imported from lib/analytics-map.ts), and a review found
// the first guard only looked one import deep. This one follows every STATIC import from each
// 'use client' file — '@/' and relative, `import` and `export … from`, through as many modules as it
// takes — and fails on reaching a server module or any src/data file. The one sanctioned door to
// src/data is a DYNAMIC import() of the baked geography in the loader, a separate chunk by design.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SERVER_ONLY = ['src/lib/analytics-map.ts', 'src/lib/analytics-major-cities.ts', 'src/lib/map-projection.ts']
const LOADER = 'src/components/ui/map-geography-loader.ts'
const rel = (p: string) => relative(ROOT, p)

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

/** The files a module statically imports or re-exports, types-only imports excluded. */
export function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    if (m[1]) continue
    const r = resolveImport(file, m[2])
    if (r) out.push(r)
  }
  return out
}

function reached(file: string, seen = new Set<string>()): Set<string> {
  for (const next of staticImports(file)) {
    if (seen.has(next)) continue
    seen.add(next)
    if (/\.tsx?$/.test(next)) reached(next, seen)
  }
  return seen
}

describe('client components and the map\'s server modules', () => {
  const client = filesUnder(join(ROOT, 'src')).filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))

  it('the walker follows imports more than one module deep — or the next test proves nothing', () => {
    const section = client.find((f) => f.endsWith('places-section.tsx'))!
    const all = [...reached(section)].map(rel)
    expect(all).toContain('src/components/ui/city-table.tsx') // one hop
    expect(all).toContain('src/lib/analytics-places.ts') // two hops: section → city table → places
    expect(client.map(rel)).toEqual(expect.arrayContaining(['src/components/ui/world-map.tsx', 'src/components/ui/globe.tsx', 'src/components/ui/city-table.tsx', 'src/components/ui/places-view.tsx']))
  })

  it('CRITICAL: no client component reaches a map server module or a src/data file through its static imports, however deep', () => {
    const offenders: string[] = []
    for (const f of client) {
      for (const r of reached(f)) {
        const p = rel(r)
        if (SERVER_ONLY.includes(p) || p.startsWith('src/data/')) offenders.push(`${rel(f)} → ${p}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('CRITICAL: the baked geography is only ever loaded by the loader, and only by a dynamic import()', () => {
    const mentions = filesUnder(join(ROOT, 'src')).filter((f) => /map-(flat|globe)\.json/.test(readFileSync(f, 'utf8'))).map(rel)
    expect(mentions).toEqual([LOADER])
    const loader = readFileSync(join(ROOT, LOADER), 'utf8')
    for (const m of loader.matchAll(/^.*map-(?:flat|globe)\.json.*$/gm)) expect(m[0]).toMatch(/import\(\s*['"]@\/data\/map-(flat|globe)\.json['"]\s*\)/)
  })
})
