// The geography scripts/build-map-data.ts bakes and the browser loads once: the flat map's
// projected paths, the globe's GeoJSON, and each country's frame. Read from the committed files,
// so a rebuild that breaks an invariant fails here rather than on the page.
import { describe, expect, it } from 'vitest'
import flat from '@/data/map-flat.json'
import globe from '@/data/map-globe.json'
import frames from '@/data/country-frames.json'
import { MAP_W } from '@/lib/map-constants'

type Frame = { box: { minX: number; maxX: number; minY: number; maxY: number }; centroid: [number, number] }
const allFrames = Object.entries(frames as unknown as Record<string, Frame>)

describe('country-frames.json', () => {
  // A small island is a single point at a tenth of a map unit (Singapore, Malta): a real frame, which fitBox
  // opens at its deepest zoom. Only a box turned INSIDE OUT (max below min) is broken.
  it('CRITICAL: every frame is a real part of the map — finite, across it, and no wider than half of it (an inside-out ring, or a landmass across the antimeridian, framed the whole world)', () => {
    expect(allFrames.length).toBeGreaterThan(200)
    const offenders = allFrames
      .filter(([, f]) => {
        const { minX, maxX, minY, maxY } = f.box
        return ![minX, maxX, minY, maxY, ...f.centroid].every(Number.isFinite) || maxX - minX > MAP_W / 2 || minX < -1 || maxX > MAP_W + 1 || maxX < minX || maxY < minY
      })
      .map(([code, f]) => `${code}: ${JSON.stringify(f.box)}`)
    expect(offenders).toEqual([])
  })

  it('is keyed by ISO code and has the countries people are in, Russia among them', () => {
    for (const code of ['US', 'GB', 'DE', 'RU', 'AU', 'NO', 'FR', 'SG']) expect((frames as unknown as Record<string, Frame>)[code], code).toBeDefined()
    expect(allFrames.every(([code]) => /^[A-Z]{2}$/.test(code))).toBe(true)
  })
})

describe('map-flat.json', () => {
  it('CRITICAL: each country its own path at 1:50m, keyed by code, Antarctica left out; lakes, borders and US state lines as paths; all rounded to a tenth of a map unit', () => {
    expect(flat.lands.length).toBeGreaterThan(200)
    expect(flat.lands.map((l) => l.code)).not.toContain('AQ')
    expect(flat.lands.find((l) => l.code === 'US')!.d.length).toBeGreaterThan(2000)
    for (const layer of ['lakes', 'borders', 'states'] as const) expect(flat[layer].length, layer).toBeGreaterThan(500)
    for (const d of [flat.lakes, flat.borders, flat.states, ...flat.lands.map((l) => l.d)]) expect(d).not.toMatch(/\d\.\d\d/)
  })

  it('CRITICAL: stays inside its byte budget', () => {
    expect(JSON.stringify(flat).length).toBeLessThan(500_000)
  })
})

describe('map-globe.json', () => {
  it('each country as GeoJSON rounded to two decimals, Antarctica out; lakes and borders beside them', () => {
    const us = globe.lands.find((l) => l.code === 'US')!
    expect(us.geometry.type).toBe('MultiPolygon')
    expect(JSON.stringify(us.geometry.coordinates).slice(0, 400)).not.toMatch(/\d\.\d{3}/)
    expect(globe.lands.map((l) => l.code)).not.toContain('AQ')
    expect(globe.lakes.type).toBe('FeatureCollection')
    expect(globe.borders.type).toBe('MultiLineString')
  })

  it('CRITICAL: stays inside its byte budget', () => {
    expect(JSON.stringify(globe).length).toBeLessThan(300_000)
  })
})
