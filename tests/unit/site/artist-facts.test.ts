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
  })
})
