// The allowlist behind saving an artist fact.
/** artistFactUpdate — the runtime allowlist behind saveArtistFactAction (SEO_GEO_PLAN B6). */
import { describe, expect, it } from 'vitest'
import { ARTIST_FACT_COLUMNS, SCHEMA_TYPES, artistFactUpdate } from '@/lib/artist-facts'

describe('artistFactUpdate', () => {
  it('CRITICAL: only the fact columns — never slug, template, or anything a caller names', () => {
    for (const col of ['slug', 'template', 'name', 'id', 'manager_id', '']) expect(artistFactUpdate(col, 'x')).toEqual({ error: 'Unknown field.' })
    for (const col of ARTIST_FACT_COLUMNS) expect('error' in artistFactUpdate(col, col === 'schema_type' ? SCHEMA_TYPES[0] : 'x')).toBe(false)
  })
  it('schema_type is the registry only; text facts trim, cap at 120, blank clears', () => {
    for (const t of SCHEMA_TYPES) expect(artistFactUpdate('schema_type', ` ${t} `)).toEqual({ column: 'schema_type', value: t })
    expect(artistFactUpdate('schema_type', 'Band')).toEqual({ error: 'Unknown artist type.' })
    expect(artistFactUpdate('genre', '  House,   Techno ')).toEqual({ column: 'genre', value: 'House, Techno' })
    expect(artistFactUpdate('location', '')).toEqual({ column: 'location', value: null })
    expect('error' in artistFactUpdate('location', 'x'.repeat(121))).toBe(true)
    // Both text facts are capped at 120 exactly, each on its own path (the city has its own
    // rule since the place facts, so it can no longer stand in for genre's cap).
    for (const col of ['genre', 'location'] as const) {
      expect(artistFactUpdate(col, 'x'.repeat(120)), col).toEqual({ column: col, value: 'x'.repeat(120) })
      expect(artistFactUpdate(col, 'x'.repeat(121)), col).toEqual({ error: 'Keep it under 120 characters.' })
    }
  })
  it('CRITICAL: the city ("Based in") follows the fact text rule: no markup, no control characters, no hidden marks', () => {
    expect(artistFactUpdate('location', '</script><script>alert(1)</script>')).toEqual({ error: 'Leave out < and >.' })
    expect(artistFactUpdate('location', 'Chi\u0000cago')).toEqual({ error: 'That has hidden characters in it. Type it again.' })
    expect(artistFactUpdate('location', '\u200FChicago\u202E')).toEqual({ column: 'location', value: 'Chicago' })
    expect(artistFactUpdate('location', "Côte d'Ivoire")).toEqual({ column: 'location', value: "Côte d'Ivoire" })
    expect(artistFactUpdate('location', 'São Paulo 🎧')).toEqual({ column: 'location', value: 'São Paulo 🎧' })
  })
})
