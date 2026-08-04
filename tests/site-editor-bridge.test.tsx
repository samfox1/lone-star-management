// @vitest-environment jsdom
/**
 * Frame-side bridge resolution (phase 1): a click anywhere in the edit-mode frame
 * resolves to the nearest marked region (an inner item beats its enclosing slot),
 * so the frame can report the right SelectTarget to the editor over the bridge.
 * Pure DOM logic — no postMessage plumbing here.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  applyFieldToDom,
  applyHighlightToDom,
  applyImageToDom,
  applyLinkToDom,
  applyStyleToDom,
  clearHighlightFromDom,
  mountFrameBridge,
  READY_RETRIES,
  READY_RETRY_MS,
  highlightSelector,
  markedAncestor,
  targetOf,
} from '@/lib/site-editor/bridge-client'
import { BRIDGE_VERSION } from '@/lib/site-editor/bridge'

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

  it('applyStyleToDom REPLACES a section region class string', () => {
    document.body.innerHTML = `<h1 data-lse-style="hero_wordmark" class="font-glitch text-9xl">SKEEN</h1>`
    applyStyleToDom(document, 'hero_wordmark', 'font-momo uppercase')
    expect(document.querySelector('[data-lse-style="hero_wordmark"]')!.getAttribute('class')).toBe('font-momo uppercase')
  })

  it('a per-item overlay lands as INLINE STYLE — the base classes are never disturbed', () => {
    // The item editor starts EMPTY and emits only the manager's overlay. It applies as
    // inline CSS: a class could be uncompiled by the site's build, or outranked by a
    // same-property base class via stylesheet order. Inline is deterministic.
    document.body.innerHTML = `<img data-lse-style="slot:polaroid_1_photo" class="w-full object-cover">`
    const el = () => document.querySelector('[data-lse-style="slot:polaroid_1_photo"]') as HTMLElement
    applyStyleToDom(document, 'slot:polaroid_1_photo', 'scale-110')
    expect(el().getAttribute('class')).toBe('w-full object-cover')
    expect(el().style.scale).toBe('1.1')
    // A second overlay replaces the FIRST overlay, not the base — no compounding as the
    // manager drags a slider.
    applyStyleToDom(document, 'slot:polaroid_1_photo', 'scale-125 rounded-[6px]')
    expect(el().style.scale).toBe('1.25')
    expect(el().style.borderRadius).toBe('6px')
    // Clearing returns the element to exactly its base: classes AND managed inline props.
    applyStyleToDom(document, 'slot:polaroid_1_photo', '')
    expect(el().getAttribute('class')).toBe('w-full object-cover')
    expect(el().style.scale).toBe('')
    expect(el().style.borderRadius).toBe('')
  })

  it('border width + colour both apply inline, and "None" clears them', () => {
    document.body.innerHTML = `<img data-lse-style="slot:polaroid_1_photo" class="w-full">`
    const el = () => document.querySelector('[data-lse-style="slot:polaroid_1_photo"]') as HTMLElement
    applyStyleToDom(document, 'slot:polaroid_1_photo', 'border-[4px] border-[#123abc]')
    expect(el().getAttribute('class')).toBe('w-full')
    expect(el().style.borderWidth).toBe('4px')
    expect(el().style.borderColor).toBe('rgb(18, 58, 188)') // the CSSOM normalises the hex
    // Picking a different colour replaces it.
    applyStyleToDom(document, 'slot:polaroid_1_photo', 'border-[4px] border-[#ff0000]')
    expect(el().style.borderColor).toBe('rgb(255, 0, 0)')
    // Choosing "None" clears the colour rather than leaving the last one stuck.
    applyStyleToDom(document, 'slot:polaroid_1_photo', 'border-[4px]')
    expect(el().style.borderColor).toBe('')
    expect(el().style.borderWidth).toBe('4px')
  })

  it('applies speed-[Nx] as playbackRate on the marked video, or a video inside the region', () => {
    document.body.innerHTML = `
      <div data-lse-style="slot:hero_landscape" class="absolute inset-0"><video id="clip"></video></div>
      <video data-lse-style="video:v1" id="direct" class="w-full"></video>`
    const clip = document.getElementById('clip') as HTMLVideoElement
    const direct = document.getElementById('direct') as HTMLVideoElement
    // A wrapper region reaches the video inside it; neither token lands as a class.
    applyStyleToDom(document, 'slot:hero_landscape', 'speed-[1.5x] opacity-50')
    expect(clip.playbackRate).toBe(1.5)
    const wrapper = document.querySelector('[data-lse-style="slot:hero_landscape"]') as HTMLElement
    expect(wrapper.getAttribute('class')).toBe('absolute inset-0')
    expect(wrapper.style.opacity).toBe('0.5')
    // A directly-marked video takes it too.
    applyStyleToDom(document, 'video:v1', 'speed-[0.5x]')
    expect(direct.playbackRate).toBe(0.5)
    // Clearing the token resets to normal speed instead of leaving the last rate stuck.
    applyStyleToDom(document, 'slot:hero_landscape', 'opacity-50')
    expect(clip.playbackRate).toBe(1)
  })

  it('applyImageToDom repaints the marked <img>, or the first img inside the region', () => {
    document.body.innerHTML = `
      <img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">
      <div data-lse-field="hero_image"><img id="inner" src="https://x/old2.jpg"></div>
      <div data-lse-field="empty_slot">Add photo</div>`
    applyImageToDom(document, 'polaroid_1_photo', 'https://x/new.jpg')
    expect((document.querySelector('[data-lse-field="polaroid_1_photo"]') as HTMLImageElement).src).toBe('https://x/new.jpg')
    applyImageToDom(document, 'hero_image', 'https://x/new2.jpg')
    expect((document.getElementById('inner') as HTMLImageElement).src).toBe('https://x/new2.jpg')
    // Never writes text — a URL as textContent is worse than no repaint.
    applyImageToDom(document, 'empty_slot', 'https://x/new3.jpg')
    expect(document.querySelector('[data-lse-field="empty_slot"]')!.textContent).toBe('Add photo')
    // '' (a cleared slot) is left to the init-data refresh.
    applyImageToDom(document, 'polaroid_1_photo', '')
    expect((document.querySelector('[data-lse-field="polaroid_1_photo"]') as HTMLImageElement).src).toBe('https://x/new.jpg')
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

describe('highlight — the editor outlines a region in the frame', () => {
  it('builds the marker selector for each target kind (inverse of targetOf)', () => {
    expect(highlightSelector({ kind: 'field', key: 'hero_image' })).toBe('[data-lse-field="hero_image"]')
    expect(highlightSelector({ kind: 'slot', key: 'shows' })).toBe('[data-lse-slot="shows"]')
    expect(highlightSelector({ kind: 'item', assetType: 'image', id: 'abc-123' })).toBe(
      '[data-lse-item="image:abc-123"]',
    )
    expect(highlightSelector({ kind: 'style', key: 'hero' })).toBe('[data-lse-style="hero"]')
    expect(highlightSelector({ kind: 'link', key: 'usb' })).toBe('[data-lse-link="usb"]')
  })

  it('marks the matched element and returns it', () => {
    document.body.innerHTML = `<img data-lse-field="hero_image" src="h.jpg" />`
    const el = applyHighlightToDom(document, { kind: 'field', key: 'hero_image' })
    expect(el).toBe(document.querySelector('[data-lse-field="hero_image"]'))
    expect(el!.hasAttribute('data-lse-highlight')).toBe(true)
  })

  it('moves the highlight — the previous holder loses it (only one at a time)', () => {
    document.body.innerHTML = `
      <img data-lse-field="hero_image" src="h.jpg" />
      <div data-lse-item="image:g1"></div>`
    applyHighlightToDom(document, { kind: 'field', key: 'hero_image' })
    applyHighlightToDom(document, { kind: 'item', assetType: 'image', id: 'g1' })
    expect(document.querySelectorAll('[data-lse-highlight]')).toHaveLength(1)
    expect(document.querySelector('[data-lse-item="image:g1"]')!.hasAttribute('data-lse-highlight')).toBe(true)
  })

  it('returns null and marks nothing when the region is absent', () => {
    document.body.innerHTML = `<p>nothing marked</p>`
    expect(applyHighlightToDom(document, { kind: 'field', key: 'missing' })).toBeNull()
    expect(document.querySelector('[data-lse-highlight]')).toBeNull()
  })

  it('clearHighlightFromDom removes the marker from wherever it sits', () => {
    document.body.innerHTML = `<img data-lse-field="hero_image" data-lse-highlight src="h.jpg" />`
    clearHighlightFromDom(document)
    expect(document.querySelector('[data-lse-highlight]')).toBeNull()
  })
})

describe('mountFrameBridge — the ready handshake', () => {
  /** A stand-in for the editor window: records every postMessage it receives. */
  function fakeEditor() {
    const posts: { msg: Record<string, unknown>; origin: string }[] = []
    return {
      posts,
      readyCount: () => posts.filter((p) => p.msg.type === 'ready').length,
      target: {
        postMessage: (msg: Record<string, unknown>, origin: string) => posts.push({ msg, origin }),
      } as unknown as Window,
    }
  }
  const mount = (editor: ReturnType<typeof fakeEditor>) =>
    mountFrameBridge({ editorOrigin: 'http://localhost:3000', target: editor.target })

  it('announces ready to the editor origin, never to "*"', () => {
    const editor = fakeEditor()
    const teardown = mount(editor)
    const ready = editor.posts.find((p) => p.msg.type === 'ready')!
    expect(ready.origin).toBe('http://localhost:3000')
    expect(ready.msg.source).toBe('lse-frame')
    teardown()
  })

  it('KEEPS announcing until the editor answers, then stops', () => {
    // Announced once, a ready posted before the editor attached its listener was lost
    // with no error, and the panel silently showed "0 regions" with no components.
    vi.useFakeTimers()
    try {
      const editor = fakeEditor()
      const teardown = mount(editor)
      expect(editor.readyCount()).toBe(1)
      vi.advanceTimersByTime(READY_RETRY_MS * 3)
      expect(editor.readyCount()).toBeGreaterThan(1)

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:3000',
          data: { v: BRIDGE_VERSION, source: 'lse-editor', type: 'clear-highlight' },
        }),
      )
      const settled = editor.readyCount()
      vi.advanceTimersByTime(READY_RETRY_MS * 10)
      expect(editor.readyCount()).toBe(settled)
      teardown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up rather than announcing forever when no editor is there', () => {
    vi.useFakeTimers()
    try {
      const editor = fakeEditor()
      const teardown = mount(editor)
      vi.advanceTimersByTime(READY_RETRY_MS * (READY_RETRIES + 50))
      expect(editor.readyCount()).toBeLessThanOrEqual(READY_RETRIES)
      teardown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('teardown stops the announcements', () => {
    vi.useFakeTimers()
    try {
      const editor = fakeEditor()
      mount(editor)()
      const after = editor.readyCount()
      vi.advanceTimersByTime(READY_RETRY_MS * 10)
      expect(editor.readyCount()).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('hello — the editor asks the frame to announce', () => {
  function fakeEditor() {
    const posts: { msg: Record<string, unknown>; origin: string }[] = []
    return {
      posts,
      readyCount: () => posts.filter((p) => p.msg.type === 'ready').length,
      target: {
        postMessage: (msg: Record<string, unknown>, origin: string) => posts.push({ msg, origin }),
      } as unknown as Window,
    }
  }
  const hello = () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://localhost:3000',
        data: { v: BRIDGE_VERSION, source: 'lse-editor', type: 'hello' },
      }),
    )

  it('answers a late hello with a fresh ready — the recovery a one-way handshake lacked', () => {
    vi.useFakeTimers()
    try {
      const editor = fakeEditor()
      const teardown = mountFrameBridge({ editorOrigin: 'http://localhost:3000', target: editor.target })
      // Spend every announcement into the void, as when the editor mounts late.
      vi.advanceTimersByTime(READY_RETRY_MS * (READY_RETRIES + 5))
      const spent = editor.readyCount()
      hello()
      expect(editor.readyCount()).toBe(spent + 1)
      teardown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers every hello, so a re-mounted editor can always reconnect', () => {
    const editor = fakeEditor()
    const teardown = mountFrameBridge({ editorOrigin: 'http://localhost:3000', target: editor.target })
    const before = editor.readyCount()
    hello()
    hello()
    expect(editor.readyCount()).toBe(before + 2)
    teardown()
  })

  it('ignores a hello from any other origin', () => {
    const editor = fakeEditor()
    const teardown = mountFrameBridge({ editorOrigin: 'http://localhost:3000', target: editor.target })
    const before = editor.readyCount()
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { v: BRIDGE_VERSION, source: 'lse-editor', type: 'hello' },
      }),
    )
    expect(editor.readyCount()).toBe(before)
    teardown()
  })
})
