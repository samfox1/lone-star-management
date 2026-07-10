// @vitest-environment jsdom
/**
 * Frame-side bridge resolution (phase 1): a click anywhere in the edit-mode frame
 * resolves to the nearest marked region (an inner item beats its enclosing slot),
 * so the frame can report the right SelectTarget to the editor over the bridge.
 * Pure DOM logic — no postMessage plumbing here.
 */
import { describe, expect, it } from 'vitest'
import { markedAncestor, targetOf } from '@/lib/site-editor/bridge-client'

describe('bridge-client — resolve a clicked element to a target', () => {
  it('resolves the NEAREST marker (an item beats its enclosing slot)', () => {
    document.body.innerHTML = `
      <section data-lse-slot="shows">
        <div data-lse-item="tour_date:abc-123"><button id="tix">Tickets</button></div>
      </section>
      <h2 data-lse-field="shows_heading">Shows</h2>`

    const item = markedAncestor(document.getElementById('tix')!)!
    expect(targetOf(item)).toEqual({ kind: 'item', assetType: 'tour_date', id: 'abc-123' })

    const heading = markedAncestor(document.querySelector('[data-lse-field]')!)!
    expect(targetOf(heading)).toEqual({ kind: 'field', key: 'shows_heading' })
  })

  it('resolves the slot when the click is in the slot but not on an item', () => {
    document.body.innerHTML = `<section data-lse-slot="shows"><p id="p">x</p></section>`
    const slot = markedAncestor(document.getElementById('p')!)!
    expect(targetOf(slot)).toEqual({ kind: 'slot', key: 'shows' })
  })

  it('returns null when the click is outside any marked region', () => {
    document.body.innerHTML = `<p id="x">nope</p>`
    expect(markedAncestor(document.getElementById('x')!)).toBeNull()
  })

  it('returns null for a malformed item marker', () => {
    document.body.innerHTML = `<div data-lse-item="bogus" id="b">x</div>`
    expect(targetOf(document.getElementById('b')!)).toBeNull()
  })
})
