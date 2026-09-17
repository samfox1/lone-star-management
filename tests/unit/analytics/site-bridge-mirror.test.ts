// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://skeenmusic.com/tour" }
// The jsdom URL is a REAL host on purpose: the default is `localhost`, which
// `isReportableContext` now refuses, so the default-browser test below would pass for
// entirely the wrong reason (inert, not wired).
// The cross-check mirror: a SECOND, independent count of the same traffic, used to decide
// whether our own numbers can be trusted (ANALYTICS_PAGE_PLAN.md, "PostHog cross-check").
//
// The whole value of this module is that it disagrees with us when we are wrong, so the
// rules worth pinning are the ones that keep it independent:
//   • PostHog counts page views ITSELF, from its own script. We never send it a `view`.
//     A mirrored view would agree with our count by construction and prove nothing — which
//     is the defect in the original plan (`capture_pageview: false` plus a mirrored view).
//   • Clicks ARE mirrored, because there is no independent source for an entity id. That
//     comparison tests the DOOR, not the browser: an event the site sent and PostHog kept
//     but our tables lack was dropped by the rate caps or rejected by validation.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MIRROR_HOST,
  MIRROR_SCRIPT_MARK,
  assetHostFor,
  createMirror,
  isMirrorConfigured,
  mirrorInitOptions,
  mirrorProps,
  type MirrorDeps,
  type PostHogLike,
} from '../../../packages/site-bridge/src/mirror'

// MUTATION SURVIVORS, 2026-09-15, all equivalent — checked one at a time, not waved past.
// `npm run mutation` leaves mirror.ts at 88.79% and these 13 are the remainder. Written
// down so the next reader does not spend an afternoon re-deriving them, and so a NEW
// survivor stands out as something that is not on this list:
//   • `typeof window !== 'undefined'` / same for document (l.148-149): the `true` and
//     `!== ''` forms both leave `win`/`doc` exactly as they were — the expression only ever
//     guards a ReferenceError. The `false` form IS killed, by the tests two lines below it.
//   • `win.posthog?.capture` (l.171): `emit` runs only when `ready`, and `ready` is set
//     only after `ph` was proved present, so the `?.` can never be the thing that fires.
//   • the `if (!ph)` dead path (l.185-186): going dead and queueing-forever are the same
//     from outside — both capture nothing, and PENDING_MAX bounds the cost either way.
//     The distinction is only worth having because "dead" is the truth.
//   • `{ once: true }` on the load listeners (l.207, 214): `start()` returns early when it
//     is already ready or dead, so a second load event is a no-op with or without it.
//   • the `^` anchor in assetHostFor: every string that could reach it is a URL, and a URL
//     cannot have text before its scheme.
// Added 2026-09-16 with the page-wide loader:
//   • an init that throws leaving the loader `loading` instead of `dead`: nothing fires a
//     second `load`, so both states capture nothing forever. Dead is kept because it is
//     the truth, and the test for it pins the outcome, not the label.
//   • `status = ""` in place of "dead" (settle, and the script-placement catch), `{ once }`
//     on the load listener, `posthog?.capture`, the `status !== "dead"` queue check, and
//     `!win`/`!doc` checked apart from `!loc`: each changes a label or a path that captures
//     nothing either way. A stubbed `window` also removes `location`, so `!loc` fires first.
//   • `!stopped ||` in the flush: a stopped mirror has already removed its waiter, so the
//     flush cannot run for it.
//   • the LOADER symbol's description: any string names one shared slot.
// And in analytics.ts, pinned by site-bridge-reportable.test.ts:
//   • the `^` anchor in isPrivateAddress: its `$` anchor already requires the host to END
//     in a dotted quad, and no real hostname does (a TLD is never all digits), so a prefix
//     before the quad cannot occur on a real page.

const CONFIG = { key: 'phc_test', slug: 'skeen' }

/** A window/document pair whose script tag never really loads: `load()` is the test's
 *  trigger, so "queued before PostHog arrived" is an ordinary, deliberate state. */
function fakeBrowser(pathname = '/tour') {
  const doc = document.implementation.createHTMLDocument('mirror')
  const win = { posthog: undefined as PostHogLike | undefined }
  const posthog: PostHogLike & { calls: unknown[][] } = {
    calls: [],
    init: (...args: unknown[]) => void posthog.calls.push(['init', ...args]),
    capture: (...args: unknown[]) => void posthog.calls.push(['capture', ...args]),
    register: (...args: unknown[]) => void posthog.calls.push(['register', ...args]),
  } as unknown as PostHogLike & { calls: unknown[][] }

  const scripts = () => Array.from(doc.querySelectorAll('script'))
  /** Stand in for the CDN: attach the global the real array.js would, then fire onload. */
  const load = () => {
    win.posthog = posthog
    for (const s of scripts()) s.dispatchEvent(new Event('load'))
  }
  const deps: MirrorDeps = {
    window: win as unknown as Window & { posthog?: PostHogLike },
    document: doc,
    // A REAL host. A review found this was `{ pathname }` alone, a shape no browser makes,
    // which ran every mirror test with an empty hostname and never touched the host rule.
    location: { pathname, hostname: 'skeenmusic.com', href: `https://skeenmusic.com${pathname}` },
  }
  return { deps, doc, posthog, scripts, load }
}

const captures = (posthog: { calls: unknown[][] }) => posthog.calls.filter(([m]) => m === 'capture')

// A stubbed `window`/`document` leaking into the next test would make it pass for the
// wrong reason — the mirror would be inert and every assertion about "nothing happened"
// would hold vacuously.
afterEach(() => {
  vi.unstubAllGlobals()
  for (const s of Array.from(document.querySelectorAll(`script[${MIRROR_SCRIPT_MARK}]`))) s.remove()
  // The page-wide loader lives on the real window too. Left behind, the next test's
  // "real browser" mirror would reuse this one's settled state and prove nothing.
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for('@samfox1/site-bridge.posthogLoader')]
})

describe('where the script comes from', () => {
  it('PostHog Cloud serves its script from a sibling -assets host', () => {
    expect(assetHostFor('https://us.i.posthog.com')).toBe('https://us-assets.i.posthog.com')
    expect(assetHostFor('https://eu.i.posthog.com')).toBe('https://eu-assets.i.posthog.com')
  })

  it('CRITICAL: a host with a PATH is a proxy route, not a Cloud host', () => {
    // PostHog's own reverse-proxy docs route through a path like `/ingest`. Losing the `$`
    // anchor would rewrite this to a sibling host that does not exist, and the mirror would
    // be silently dead — which reads as US over-counting, the exact wrong conclusion.
    expect(assetHostFor('https://us.i.posthog.com/ingest')).toBe('https://us.i.posthog.com/ingest')
  })

  it('a self-hosted install over http is still rewritten by scheme', () => {
    expect(assetHostFor('http://eu.i.posthog.com')).toBe('http://eu-assets.i.posthog.com')
  })

  it('trims however many trailing slashes it is given', () => {
    expect(assetHostFor('https://eu.i.posthog.com//')).toBe('https://eu-assets.i.posthog.com')
  })

  it('a reverse proxy serves it from the same host it answers on', () => {
    // A site that proxies PostHog through its own domain (to survive ad blockers) has no
    // sibling host; rewriting to `ph-assets.skeenmusic.com` would 404 and the mirror would
    // be silently dead — the one failure this whole module cannot afford.
    expect(assetHostFor('https://ph.skeenmusic.com')).toBe('https://ph.skeenmusic.com')
    expect(assetHostFor('https://ph.skeenmusic.com/')).toBe('https://ph.skeenmusic.com')
  })
})

describe('how PostHog is configured', () => {
  it('CRITICAL: PostHog captures its own page view once per page load, and none on navigation', () => {
    // A view is landing on the site (Sam, 2026-09-17). `history_change` would count every
    // client-side page switch, which our side deliberately does not, and the gap would read
    // as us under-counting. PostHog's same-site reloads are filtered by the comparison
    // query, from the `$referring_domain` PostHog stamps on each load itself.
    expect(mirrorInitOptions(CONFIG).capture_pageview).toBe(true)
  })

  it('stays cookieless, like the door', () => {
    expect(mirrorInitOptions(CONFIG).persistence).toBe('memory')
  })

  it('collects nothing beyond the comparison', () => {
    const o = mirrorInitOptions(CONFIG)
    expect(o.autocapture).toBe(false)
    expect(o.disable_session_recording).toBe(true)
    expect(o.disable_surveys).toBe(true)
  })

  it('defaults to PostHog Cloud US, and honours an explicit host', () => {
    expect(mirrorInitOptions(CONFIG).api_host).toBe(DEFAULT_MIRROR_HOST)
    expect(mirrorInitOptions({ ...CONFIG, host: 'https://eu.i.posthog.com//' }).api_host).toBe(
      'https://eu.i.posthog.com',
    )
  })
})

describe('what is mirrored', () => {
  it('CRITICAL: a view is NEVER mirrored — PostHog counts those itself', () => {
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    load()
    m.capture('view', {})
    expect(captures(posthog)).toHaveLength(0)
  })

  it('a click is mirrored under its own name, tagged with the site', () => {
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    load()
    m.capture('ticket_click', { entity: { kind: 'tour_date', id: 'td-1', label: 'Austin' } })
    expect(captures(posthog)).toEqual([
      ['capture', 'ticket_click', { site: 'skeen', entity_kind: 'tour_date', entity_id: 'td-1', label: 'Austin' }],
    ])
  })

  it('an entity-less click still carries the site and its label', () => {
    expect(mirrorProps('skeen', { label: 'Instagram' })).toEqual({ site: 'skeen', label: 'Instagram' })
  })

  it('omits what it does not have, rather than sending empty strings', () => {
    // An `entity_id: ''` in PostHog groups every unattributed click into one phantom row.
    expect(mirrorProps('skeen', {})).toEqual({ site: 'skeen' })
  })
})

describe('clicks that happen before the script has loaded', () => {
  it('CRITICAL: are queued and sent once it arrives, in order', () => {
    // A fan who clicks a ticket link in the first second is the MOST interesting fan on the
    // site. Dropping those would bias the comparison toward our own door, which buffers
    // nothing because it is a plain fetch.
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    m.capture('ticket_click', { label: 'first' })
    m.capture('buy_click', { label: 'second' })
    expect(captures(posthog)).toHaveLength(0)

    load()
    expect(captures(posthog).map(([, type, props]) => [type, (props as { label: string }).label])).toEqual([
      ['ticket_click', 'first'],
      ['buy_click', 'second'],
    ])
  })

  it('init runs before the queued events, so they carry the right project', () => {
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps).capture('link_click', { label: 'early' })
    load()
    expect(posthog.calls[0][0]).toBe('init')
    expect(posthog.calls[0][1]).toBe('phc_test')
  })
})

describe('what never loads the script at all', () => {
  it('no key: the site renders and reports to our door as usual', () => {
    const { deps, scripts } = fakeBrowser()
    const m = createMirror({ slug: 'skeen' }, deps)
    m.capture('buy_click', {})
    expect(scripts()).toHaveLength(0)
  })

  it("CRITICAL: the editor shell — a manager's own editing is not a fan visit", () => {
    // The door drops these too. If the mirror kept them, PostHog would show traffic ours
    // does not and the gap would be read as US under-counting.
    const { deps, scripts } = fakeBrowser('/edit/music')
    createMirror(CONFIG, deps).capture('play', {})
    expect(scripts()).toHaveLength(0)
  })

  it('CRITICAL: there is no browser at all — an SSR render is not a fan', () => {
    // skeen builds its reporter in `makeBackend`, which runs on the server too, so this is
    // a real code path and not a theoretical one. NOTE the deps must be STUBBED GLOBALS,
    // not `{ document: undefined }`: an undefined dep falls through the `??` to the real
    // global, so that version of this test passed while proving nothing. It is how the
    // first draft of this file was wrong.
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('window', undefined)
    expect(() => createMirror(CONFIG).capture('play', {})).not.toThrow()
  })

  it('a runtime with a window but no document is inert too', () => {
    // Each half checked ALONE: with both stubbed at once, a guard that only ever looked at
    // one of them would pass this suite unnoticed.
    vi.stubGlobal('document', undefined)
    expect(() => createMirror(CONFIG).capture('play', {})).not.toThrow()
  })

  it('a runtime with a document but no window is inert too', () => {
    vi.stubGlobal('window', undefined)
    const before = document.querySelectorAll(`script[${MIRROR_SCRIPT_MARK}]`).length
    createMirror(CONFIG).capture('play', {})
    expect(document.querySelectorAll(`script[${MIRROR_SCRIPT_MARK}]`)).toHaveLength(before)
  })

  it('a document that refuses to make a script is inert, not a crash', () => {
    const { deps, doc } = fakeBrowser()
    Object.defineProperty(doc, 'createElement', { value: () => { throw new Error('CSP') } })
    expect(() => createMirror(CONFIG, { ...deps, document: doc }).capture('play', {})).not.toThrow()
  })

  it('a second mirror on the same page reuses the first script', () => {
    // React StrictMode mounts effects twice in development; two array.js tags means two
    // inits and two page views for every page load.
    const { deps, scripts } = fakeBrowser()
    createMirror(CONFIG, deps)
    createMirror(CONFIG, deps)
    expect(scripts()).toHaveLength(1)
    expect(scripts()[0].getAttribute(MIRROR_SCRIPT_MARK)).toBe('skeen')
  })

  it('CRITICAL: the second mirror still works — it is the one that survives StrictMode', () => {
    // Counting the script tags is not enough. React keeps the SECOND mount, so a second
    // mirror that never became ready would mean a development site mirrors nothing, and
    // — worse — a remount in production silently stops the comparison mid-run.
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps)
    load()
    const second = createMirror(CONFIG, deps)
    second.capture('buy_click', { label: 'after remount' })
    expect(captures(posthog).map(([, , props]) => (props as { label: string }).label)).toEqual(['after remount'])
  })

  it('CRITICAL: a second mirror created before the shared script loads is flushed by it', () => {
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps)
    const second = createMirror(CONFIG, deps)
    second.capture('buy_click', { label: 'queued on the second' })
    load()
    expect(captures(posthog).map(([, , props]) => (props as { label: string }).label)).toEqual(['queued on the second'])
  })
})

describe('one PostHog per page', () => {
  it('CRITICAL: every event, PostHog\'s own page views included, is tagged with the slug before anything is captured', () => {
    // We never touch a `$pageview`, so a super-property is the only way it carries `site`,
    // and `site` is what the comparison script filters on. It must be registered BEFORE
    // any capture, or the first page view of every session lands untagged.
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps).capture('buy_click', { label: 'queued' })
    load()
    const order = posthog.calls.map(([m]) => m)
    expect(order.slice(0, 2)).toEqual(['init', 'register'])
    expect(posthog.calls[1]).toEqual(['register', { site: 'skeen' }])
    expect(order.indexOf('capture')).toBeGreaterThan(1)
  })

  it('CRITICAL: two mirrors waiting on one script init PostHog ONCE', () => {
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps)
    createMirror(CONFIG, deps)
    load()
    expect(posthog.calls.filter(([m]) => m === 'init')).toHaveLength(1)
  })

  it('CRITICAL: a mirror naming a different project, host or artist is refused, not merged', () => {
    // Otherwise it reports into the FIRST mirror's project under the first mirror's slug,
    // and nothing anywhere would say so.
    for (const other of [
      { ...CONFIG, key: 'phc_other' },
      { ...CONFIG, host: 'https://eu.i.posthog.com' },
      { ...CONFIG, slug: 'wren' },
    ]) {
      const { deps, posthog, load } = fakeBrowser()
      createMirror(CONFIG, deps)
      load()
      createMirror(other, deps).capture('buy_click', { label: 'wrong project' })
      expect(captures(posthog)).toEqual([])
    }
  })

  it('CRITICAL: a mirror created AFTER PostHog is ready does not init it again', () => {
    // Every client-side navigation on a template that mounts analytics in a page does this.
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps)
    load()
    createMirror(CONFIG, deps).capture('buy_click', { label: 'later page' })
    expect(posthog.calls.filter(([m]) => m === 'init')).toHaveLength(1)
    expect(captures(posthog)).toHaveLength(1)
  })

  it('CRITICAL: a click queued BEFORE an init that throws is never sent into that client', () => {
    const { deps, posthog, load } = fakeBrowser()
    posthog.init = () => {
      throw new Error('bad token')
    }
    createMirror(CONFIG, deps).capture('buy_click', { label: 'queued' })
    load()
    expect(captures(posthog)).toEqual([])
  })

  it('a host differing only by trailing slashes is the same host', () => {
    const { deps, posthog, load } = fakeBrowser()
    createMirror({ ...CONFIG, host: 'https://us.i.posthog.com//' }, deps)
    load()
    createMirror({ ...CONFIG, host: 'https://us.i.posthog.com' }, deps).capture('buy_click', { label: 'same' })
    expect(captures(posthog)).toHaveLength(1)
  })

  it('CRITICAL: a script that loaded while no mirror was alive is started by the next one', () => {
    // StrictMode: mount, shut down, mount again. If the script's `load` landed in the gap,
    // the second mirror must still start PostHog, or development sites never mirror and a
    // remount in production silently ends the comparison.
    const { deps, posthog, load } = fakeBrowser()
    createMirror(CONFIG, deps).shutdown()
    load()
    expect(posthog.calls).toEqual([])
    createMirror(CONFIG, deps).capture('buy_click', { label: 'after remount' })
    expect(posthog.calls.map(([m]) => m)).toEqual(['init', 'register', 'capture'])
  })
})

describe('the mirror is never the fan\'s problem', () => {
  it('a PostHog that throws does not reach the caller', () => {
    const { deps, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    load()
    ;(deps.window as unknown as { posthog: PostHogLike }).posthog.capture = () => {
      throw new Error('blocked by an extension')
    }
    expect(() => m.capture('buy_click', {})).not.toThrow()
  })

  it('CRITICAL: a script that loads but defines nothing kills the mirror, quietly', () => {
    // Found by a mutation run, 2026-09-15. `win.posthog?.init(…)` no-ops when the script
    // served an empty body (a CSP, a proxy answering with its own 200, an extension stub),
    // and the first draft then set `ready` anyway — every later click captured into a
    // no-op. array.js installs its global as it executes, so absent at `load` is absent for
    // good: the honest answer is to go dead, not to queue for a script never coming.
    const { deps, posthog, doc } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    m.capture('buy_click', { label: 'before load' })
    for (const s of Array.from(doc.querySelectorAll('script'))) s.dispatchEvent(new Event('load'))
    expect(posthog.calls).toHaveLength(0)

    // A later arrival of the global changes nothing. NOTE, per AGENTS.md: "dropped" versus
    // "queued forever" cannot be told apart from outside, since both capture nothing and
    // the queue is capped. This pins that nothing is captured, not which of the two.
    deps.window!.posthog = posthog
    m.capture('buy_click', { label: 'after' })
    expect(posthog.calls).toHaveLength(0)
  })

  it('CRITICAL: an init that throws is dead for EVERY mirror on the page', () => {
    // The shape a review found: mirror A's init threw, mirror B saw `window.posthog`,
    // assumed ready, and captured into a half-initialised client.
    const { deps, posthog, load } = fakeBrowser()
    posthog.init = () => {
      throw new Error('bad token')
    }
    const a = createMirror(CONFIG, deps)
    load()
    const b = createMirror(CONFIG, deps)
    a.capture('buy_click', { label: 'a' })
    b.capture('buy_click', { label: 'b' })
    expect(captures(posthog)).toEqual([])
  })

  it('CRITICAL: a script that never answers cannot grow the queue for the whole session', () => {
    // A hanging request fires neither `load` nor `error`. Without a cap, a long SPA session
    // would accumulate every click a fan ever made — a measuring instrument costing the fan
    // memory, which is the one thing it is never allowed to do.
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    for (let i = 0; i < 500; i += 1) m.capture('link_click', { label: `click-${i}` })
    load()
    expect(captures(posthog).length).toBeLessThanOrEqual(50)
    // The EARLIEST clicks are the ones kept: they are the ones already in the queue.
    expect((captures(posthog)[0][2] as { label: string }).label).toBe('click-0')
  })

  it('CRITICAL: after shutdown, a late-arriving script never even starts PostHog', () => {
    // Emptying the queue is not enough: `init` on an unmounted page would leave a live
    // client capturing page views for the rest of the session, inflating
    // exactly the number the comparison rests on.
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    m.capture('buy_click', {})
    m.shutdown()
    load()
    expect(posthog.calls).toHaveLength(0)
  })

  it('CRITICAL: after shutdown, a new click is ignored', () => {
    const { deps, posthog, load } = fakeBrowser()
    const m = createMirror(CONFIG, deps)
    load()
    m.shutdown()
    m.capture('buy_click', {})
    expect(captures(posthog)).toHaveLength(0)
  })
})

describe('with no deps at all, it finds the real browser', () => {
  it('uses window, document and location when the site passes none', () => {
    // Every other test injects a fake browser, so the DEFAULTS — the code path every real
    // site actually takes — were executed by nothing at all.
    for (const s of Array.from(document.querySelectorAll(`script[${MIRROR_SCRIPT_MARK}]`))) s.remove()
    const m = createMirror({ ...CONFIG, slug: 'defaults' })
    const script = document.querySelector(`script[${MIRROR_SCRIPT_MARK}="defaults"]`)
    expect(script).not.toBeNull()
    expect(script?.getAttribute('src')).toBe('https://us-assets.i.posthog.com/static/array.js')
    expect(() => m.capture('buy_click', {})).not.toThrow()
    m.shutdown()
    script?.remove()
  })
})

describe('helpers', () => {
  it('isMirrorConfigured needs both a key and a slug', () => {
    expect(isMirrorConfigured(CONFIG)).toBe(true)
    expect(isMirrorConfigured({ key: 'phc_test' })).toBe(false)
    expect(isMirrorConfigured({ slug: 'skeen' })).toBe(false)
    expect(isMirrorConfigured(null)).toBe(false)
    expect(isMirrorConfigured(undefined)).toBe(false)
  })

  it('the script is async, so it never delays the page', () => {
    const { deps, scripts } = fakeBrowser()
    createMirror(CONFIG, deps)
    const [s] = scripts()
    expect(s.async).toBe(true)
    expect(s.src).toBe('https://us-assets.i.posthog.com/static/array.js')
  })
})
