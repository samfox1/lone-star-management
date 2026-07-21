// @vitest-environment jsdom
/**
 * Frame-side bridge resolution (phase 1): a click anywhere in the edit-mode frame
 * resolves to the nearest marked region (an inner item beats its enclosing slot),
 * so the frame can report the right SelectTarget to the editor over the bridge.
 * Pure DOM logic — no postMessage plumbing here.
 */
import { describe, expect, it } from 'vitest'
import { applyFieldToDom, applyLinkToDom, applyStyleToDom, markedAncestor, targetOf } from '@/lib/site-editor/bridge-client'

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

describe('applyFieldToDom — optimistic in-frame update', () => {
  it('sets text on a text field and src on an image field', () => {
    document.body.innerHTML = `
      <h2 data-lse-field="shows_heading">Shows</h2>
      <img data-lse-field="hero_image" src="old.jpg" />`

    applyFieldToDom(document, 'shows_heading', 'Concerts')
    expect(document.querySelector('[data-lse-field="shows_heading"]')!.textContent).toBe('Concerts')

    applyFieldToDom(document, 'hero_image', 'new.jpg')
    expect(document.querySelector('[data-lse-field="hero_image"]')!.getAttribute('src')).toBe('new.jpg')
  })

  it('no-ops when the field is not present', () => {
    document.body.innerHTML = `<p>nothing marked</p>`
    expect(() => applyFieldToDom(document, 'missing', 'x')).not.toThrow()
  })
})

describe('style regions — resolve + optimistic restyle', () => {
  it('resolves a style-only region to a style target (lowest precedence)', () => {
    document.body.innerHTML = `<h1 data-lse-style="hero_wordmark" id="h">SKEEN</h1>`
    expect(targetOf(document.getElementById('h')!)).toEqual({ kind: 'style', key: 'hero_wordmark' })
  })

  it('a field wins over style on the same element (content selects on click)', () => {
    document.body.innerHTML = `<h1 data-lse-field="artist_name" data-lse-style="hero_wordmark" id="h">SKEEN</h1>`
    expect(targetOf(document.getElementById('h')!)).toEqual({ kind: 'field', key: 'artist_name' })
  })

  it('applyStyleToDom REPLACES the region class string (incl. a per-item key)', () => {
    document.body.innerHTML = `
      <h1 data-lse-style="hero_wordmark" class="font-glitch text-9xl">SKEEN</h1>
      <div data-lse-style="videos:abc-123" class="border"></div>`
    applyStyleToDom(document, 'hero_wordmark', 'font-momo uppercase')
    expect(document.querySelector('[data-lse-style="hero_wordmark"]')!.getAttribute('class')).toBe('font-momo uppercase')
    applyStyleToDom(document, 'videos:abc-123', 'rounded')
    expect(document.querySelector('[data-lse-style="videos:abc-123"]')!.getAttribute('class')).toBe('rounded')
  })

  it('no-ops when the style region is not present', () => {
    document.body.innerHTML = `<p>nothing marked</p>`
    expect(() => applyStyleToDom(document, 'missing', 'x')).not.toThrow()
  })
})

describe('link regions — resolve + optimistic href (Phase 2)', () => {
  it('resolves a link-only element to a link target (lowest precedence)', () => {
    document.body.innerHTML = `<a data-lse-link="usb" id="u">USB</a>`
    expect(targetOf(document.getElementById('u')!)).toEqual({ kind: 'link', key: 'usb' })
  })

  it('a field/style wins over link on the same element (content selects on click)', () => {
    document.body.innerHTML = `<a data-lse-link="usb" data-lse-style="usb_btn" id="u">USB</a>`
    expect(targetOf(document.getElementById('u')!)).toEqual({ kind: 'style', key: 'usb_btn' })
  })

  it('applyLinkToDom sets the href by key, and clears it when the url is blank', () => {
    document.body.innerHTML = `<a data-lse-link="usb" id="u">USB</a>`
    applyLinkToDom(document, 'usb', 'https://open.spotify.com/playlist/usb')
    expect(document.getElementById('u')!.getAttribute('href')).toBe('https://open.spotify.com/playlist/usb')
    applyLinkToDom(document, 'usb', '')
    expect(document.getElementById('u')!.hasAttribute('href')).toBe(false)
  })

  it('no-ops when the link region is not present', () => {
    document.body.innerHTML = `<p>nothing marked</p>`
    expect(() => applyLinkToDom(document, 'missing', 'x')).not.toThrow()
  })
})
