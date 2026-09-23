/**
 * The hover's facts: which streaming service a listener picked for a song, and
 * whether a merch click opened the product or added it to the cart.
 *
 * The site encodes both in `target`: a play is reported as `<service>:<title>`
 * (MusicGrid's platform picker, the ONE place a play fires), and a merch click is
 * either the literal `add_to_cart` or the product's own title from the grid tile.
 */
import { describe, expect, it } from 'vitest'
import { entityFacts, SERVICES, type TargetRow } from '@/lib/analytics'

const row = (entity_id: string, type: string, target: string, count: number): TargetRow =>
  ({ entity_type: type === 'play' ? 'track' : 'merch', entity_id, type, target, count })

describe('entityFacts — songs', () => {
  it('splits a song by the service the listener picked, as a percent', () => {
    const f = entityFacts([
      row('a', 'play', 'soundcloud:Rushing Back', 6),
      row('a', 'play', 'spotify:Rushing Back', 4),
    ])
    expect(f.a).toEqual({
      kind: 'song',
      services: [{ key: 'soundcloud', pct: 60 }, { key: 'spotify', pct: 40 }],
    })
  })

  it('CRITICAL: one service reads 100%, which is every song today — not an empty split', () => {
    const f = entityFacts([row('a', 'play', 'soundcloud:Rushing Back', 67)])
    expect(f.a).toEqual({ kind: 'song', services: [{ key: 'soundcloud', pct: 100 }] })
  })

  it('ranks services by share, so the one they chose most leads', () => {
    const f = entityFacts([
      row('a', 'play', 'spotify:X', 1),
      row('a', 'play', 'soundcloud:X', 9),
    ])
    expect(f.a.kind === 'song' && f.a.services.map((s) => s.key)).toEqual(['soundcloud', 'spotify'])
  })

  it('CRITICAL: percentages of a real split always total 100, whatever the rounding', () => {
    // 1/3 each would round to 33+33+33=99 and the bar would not fill. The largest
    // remainder takes the slack, so the row never reads as if a play went missing.
    const f = entityFacts([
      row('a', 'play', 'spotify:X', 1),
      row('a', 'play', 'soundcloud:X', 1),
      row('a', 'play', 'apple:X', 1),
    ])
    expect(f.a.kind === 'song' && f.a.services.reduce((n, s) => n + s.pct, 0)).toBe(100)
  })

  it('ignores a play whose target never named a service — it cannot be attributed', () => {
    const f = entityFacts([
      row('a', 'play', 'soundcloud:X', 3),
      row('a', 'play', 'X', 7), // older shape, no service prefix
    ])
    expect(f.a).toEqual({ kind: 'song', services: [{ key: 'soundcloud', pct: 100 }] })
  })

  it('knows only the services the site can actually link to', () => {
    expect(SERVICES).toEqual(['spotify', 'soundcloud', 'apple'])
    const f = entityFacts([row('a', 'play', 'bandcamp:X', 5)])
    expect(f.a).toBeUndefined()
  })
})

describe('entityFacts — merch', () => {
  it('CRITICAL: separates adding to cart from merely opening the product', () => {
    const f = entityFacts([
      row('m', 'buy_click', 'add_to_cart', 4),
      row('m', 'buy_click', 'Tour Tee 2026', 6),
    ])
    expect(f.m).toEqual({ kind: 'merch', opened: 6, cart: 4 })
  })

  it('counts an external store click as opening, not as a cart add', () => {
    const f = entityFacts([row('m', 'buy_click', 'buy_on_store', 3)])
    expect(f.m).toEqual({ kind: 'merch', opened: 3, cart: 0 })
  })

  it('a product nobody added still reports zero rather than vanishing', () => {
    const f = entityFacts([row('m', 'buy_click', 'Logo Tote', 1)])
    expect(f.m).toEqual({ kind: 'merch', opened: 1, cart: 0 })
  })
})
