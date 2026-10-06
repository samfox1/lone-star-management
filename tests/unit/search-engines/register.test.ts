/**
 * Registering a site runs its steps in order, stops safely, and never leaves a wrong artist holding
 * a site.
 *
 * Code:     src/lib/search-engines/register.ts (registerSite, metaTags, tagsLive)
 * Feature:  Add website · registering a site with Google and Bing (ADD_WEBSITE_PLAN.md step 4)
 * Tier:     STRICT (AGENTS.md "Test depth"): this decides which artist a site is attached to and
 *           what Tapir claims at Google and Bing. The plan's rules, and the post-push audit's:
 *           connect LAST (after this artist's codes are seen live), upsert so a rerun is clean,
 *           remove what a failed run created, never register an address another artist holds.
 * Covers:   • the happy path in order: address → codes → store → live → connect → Google verify,
 *             property, sitemap → Bing verify, feed; the owner email reaches Google
 *           • a rerun: same codes keep their verified state; a new code or address resets it
 *           • tags never live: the rows this run created are removed, older ones marked
 *             not_live, nothing connected, nothing verified
 *           • stopped (Ctrl-C, mid-sleep) or a call throwing during the wait: rows put back exactly
 *           • an address another artist holds, a bad address: stop before any code is made
 *           • no Google code (no key, or refused): stop before storing anything or asking Bing
 *           • one provider failing never stops the other; each failure is stored as its code;
 *             a refused verify un-verifies a row verified before; verified-but-sitemap-refused is
 *             verified with the reason kept
 *           • Bing not set up or giving no code: left out, never stored without a code; a moved
 *             address resets verification; a Bing row left at the old address is removed, only
 *             once the new address is live
 *           • an already-connected artist isn't rewritten (slash, case); anyone else is connected;
 *             the live check reads real <meta> tags (never data-name / data-content) and ignores
 *             ones without a name or content
 * Not here: the Supabase store's queries (tests/integration/site/site-register-store.test.ts);
 *           the Google and Bing calls themselves (google.test.ts, bing.test.ts).
 * Fixtures: an in-memory store, fake Google and Bing clients, and a scripted home page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { metaTags, registerSite, tagsLive, type Provider, type RegisterDeps, type RegisterStore, type Row } from '@/lib/search-engines/register'

const ARTIST = 'artist-a'
const SITE = 'https://www.skeenmusic.com/'
const G = 'ptl8bmwM1LyyV7c1h9f8Jkz9aQ-lsnRVg5ZlwCmG1ZI'
const B = 'DFA80FE427DDB6FD866F4B6A6564E412'
const page = (g: string | null, b: string | null) =>
  `<html><head><title>x</title>${g ? `<meta name="google-site-verification" content="${g}"/>` : ''}${b ? `<meta content='${b}' name='msvalidate.01'>` : ''}</head></html>`

/** An in-memory store that logs what happened, in order. */
function memStore(init: { rows?: Row[]; holder?: string | null; site?: { site_kind: string | null; custom_site_url: string | null } } = {}) {
  const rows = new Map<Provider, Row>((init.rows ?? []).map((r) => [r.provider, { ...r }]))
  const events: string[] = []
  let site = init.site ?? { site_kind: 'template', custom_site_url: null }
  const store: RegisterStore = {
    holderOf: async () => init.holder ?? null,
    rowsOf: async () => [...rows.values()].map((r) => ({ ...r })),
    upsert: async (_a, list) => {
      for (const r of list) {
        const old = rows.get(r.provider)
        rows.set(r.provider, { provider: r.provider, site_url: r.site_url, code: r.code, error_code: null, verified_at: r.reset ? null : (old?.verified_at ?? null) })
        events.push(`upsert ${r.provider}`)
      }
    },
    remove: async (_a, ps) => {
      for (const p of ps) rows.delete(p)
      events.push(`remove ${ps.join(',')}`)
    },
    restore: async (_a, list) => {
      for (const r of list) rows.set(r.provider, { ...r })
      events.push(`restore ${list.map((r) => r.provider).join(',')}`)
    },
    mark: async (_a, p, r) => {
      const row = rows.get(p)!
      row.error_code = r.error_code
      row.verified_at = r.verified ? 'now' : null
      events.push(`mark ${p} ${r.verified ? 'verified' : 'not'} ${r.error_code ?? ''}`.trim())
    },
    siteOf: async () => site,
    connect: async (_a, origin) => {
      site = { site_kind: 'custom', custom_site_url: origin }
      events.push(`connect ${origin}`)
    },
  }
  return { store, rows, events, site: () => site }
}

type Fail = { ok: false; reason: string; detail?: string }
const ok = <T,>(value: T) => ({ ok: true as const, value })

/** Fake Google and Bing that log their calls into the same event list. */
function providers(events: string[], over: { google?: Partial<Record<string, () => Fail>>; bing?: Partial<Record<string, () => Fail>> } = {}) {
  const g = (name: string, value: unknown) => async (...args: unknown[]) => {
    events.push(`google ${name}${name === 'verify' ? ` owners=${JSON.stringify(args[1])}` : ''}`)
    return over.google?.[name]?.() ?? ok(value)
  }
  const b = (name: string, value: unknown) => async () => {
    events.push(`bing ${name}`)
    return over.bing?.[name]?.() ?? ok(value)
  }
  return {
    google: { getMetaToken: g('token', G), verify: g('verify', true), addSite: g('addSite', true), submitSitemap: g('sitemap', true) } as unknown as RegisterDeps['google'],
    bing: { addSite: b('addSite', true), siteCode: b('code', B), verify: b('verify', true), submitFeed: b('feed', true) } as unknown as RegisterDeps['bing'],
  }
}

/** Deps with the tags live from the first look, unless `home` says otherwise. */
function deps(mem: ReturnType<typeof memStore>, extra: Partial<RegisterDeps> = {}, over: Parameters<typeof providers>[1] = {}): RegisterDeps {
  let t = 0
  return {
    store: mem.store,
    ...providers(mem.events, over),
    resolveAddress: async () => ({ ok: true, siteUrl: SITE }),
    fetchHome: async () => {
      mem.events.push('look')
      return page(G, B)
    },
    owners: ['sam@example.com'],
    sleep: async (ms) => {
      t += ms
    },
    now: () => t,
    waitMs: 60_000,
    pollMs: 10_000,
    ...extra,
  }
}

describe('the live check reads real <meta> tags', () => {
  // Attribute order and quote style vary by framework; both must count.
  it('finds both tags whatever the attribute order or quotes', () => {
    expect(metaTags(page(G, B)).get('msvalidate.01')).toEqual([B])
    expect(tagsLive(page(G, B), { google: G, bing: B })).toBe(true)
  })

  // Google and Bing read <head>: a tag in the body doesn't count; tag and attribute case don't matter.
  it('reads only <head>, in any case', () => {
    expect(tagsLive(`<html><head></head><body>${page(G, B)}</body></html>`, { google: G })).toBe(false)
    expect(tagsLive(`<HEAD><META NAME="google-site-verification" CONTENT="${G}"></HEAD>`, { google: G })).toBe(true)
  })

  // Tags without a name or content (charset, viewport, property=…) don't confuse it.
  it('ignores meta tags with no name or no content', () => {
    const html = `<meta charset="utf-8"><meta name="viewport"><meta property="og:title" content="x">${page(G, B)}`
    expect(tagsLive(html, { google: G, bing: B })).toBe(true)
    expect(metaTags('<meta name="a">').size).toBe(0)
  })

  // `data-name` / `data-content` are other attributes: they neither stand in for name and content
  // nor hide the real ones written after them.
  it('reads name and content, never data-name or data-content', () => {
    expect(tagsLive(`<head><meta data-name="google-site-verification" data-content="${G}"></head>`, { google: G })).toBe(false)
    expect(tagsLive(`<head><meta data-name="x" data-content="y" name="google-site-verification" content="${G}"></head>`, { google: G })).toBe(true)
  })

  // The wrong code, a missing tag, or no page at all is not live.
  it('is not live when a code is missing or different', () => {
    expect(tagsLive(page(G, null), { google: G, bing: B })).toBe(false)
    expect(tagsLive(page('someoneElsesCode0123456789', B), { google: G, bing: B })).toBe(false)
    expect(tagsLive(null, { google: G })).toBe(false)
  })
})

describe('registerSite', () => {
  // The whole run, in the plan's order; the owner email reaches Google; the sitemap is the site's own.
  it('runs every step in order and connects only after the tags are live', async () => {
    const mem = memStore()
    const lines: string[] = []
    const sitemaps: string[] = []
    const d = deps(mem, { log: (l) => lines.push(l) })
    const g = d.google!
    const b = d.bing!
    d.google = { ...g, submitSitemap: async (site: string, map: string) => (sitemaps.push(`google ${site} ${map}`), g.submitSitemap(site, map)) }
    d.bing = { ...b, submitFeed: async (site: string, feed: string) => (sitemaps.push(`bing ${site} ${feed}`), b.submitFeed(site, feed)) }
    const out = await registerSite(ARTIST, 'https://skeenmusic.com', d)
    expect(sitemaps).toEqual([`google ${SITE} ${SITE}sitemap.xml`, `bing ${SITE} ${SITE}sitemap.xml`])
    expect(out.steps.map((st) => st.step)).toEqual([
      `address ${SITE}`, 'google code', 'bing code', 'stored google + bing', 'tags live on the site', 'connected to the artist as https://www.skeenmusic.com',
      'google verified', 'google property added', 'google sitemap sent', 'bing verified', 'bing sitemap sent',
    ])
    expect(lines[0]).toBe(`✔ address ${SITE}`)
    expect(out).toMatchObject({ ok: true, siteUrl: SITE, verified: ['google', 'bing'], connected: true })
    expect(mem.events).toEqual([
      'google token',
      'bing addSite',
      'bing code',
      'upsert google',
      'upsert bing',
      'look',
      'connect https://www.skeenmusic.com',
      'google verify owners=["sam@example.com"]',
      'google addSite',
      'google sitemap',
      'mark google verified',
      'bing verify',
      'bing feed',
      'mark bing verified',
    ])
    expect(mem.rows.get('google')).toMatchObject({ code: G, site_url: SITE, verified_at: 'now', error_code: null })
    expect(mem.rows.get('bing')).toMatchObject({ code: B, site_url: SITE, verified_at: 'now', error_code: null })
  })

  // It waits for ISR: keeps looking until the tags appear, then goes on.
  it('keeps looking until the tags go live', async () => {
    const mem = memStore()
    let looks = 0
    const out = await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => (++looks < 3 ? page(null, null) : page(G, B)) }))
    expect(out.ok).toBe(true)
    expect(looks).toBe(3)
  })

  // A typo or the wrong artist: the codes never show, so nothing this run made may stay behind.
  it('removes what it created, connects nothing and verifies nothing when the tags never go live', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => (mem.events.push('look'), page(null, null)) }))
    expect(out).toMatchObject({ ok: false, connected: false, verified: [] })
    expect(mem.rows.size).toBe(0)
    // It looked every 10 s for the whole 60 s (the first look at 0 s, the last at 60 s), then gave up.
    expect(mem.events.filter((e) => e === 'look')).toHaveLength(7)
    expect(out.steps.at(-1)).toMatchObject({ detail: 'not seen within 60 s' })
    expect(mem.events).toContain('remove google,bing')
    expect(mem.events.some((e) => e.startsWith('connect') || e.includes(' verify'))).toBe(false)
    expect(out.steps.at(-1)).toMatchObject({ ok: false, reason: 'not_live' })
  })

  // A rerun at a WRONG address (a typo) must not drag older rows onto it: they go back as they were.
  it('puts older rows back at their old address when the tags never go live', async () => {
    const old = { provider: 'google' as const, site_url: 'https://www.skeenmusic.com/', code: G, verified_at: 'earlier', error_code: null }
    const mem = memStore({ rows: [old] })
    await registerSite(ARTIST, 'https://www.skeenmusik.com', deps(mem, { resolveAddress: async () => ({ ok: true, siteUrl: 'https://www.skeenmusik.com/' }), fetchHome: async () => page(null, null) }))
    expect(mem.rows.get('google')).toEqual({ ...old, error_code: 'not_live' })
    expect(mem.events).toContain('restore google')
  })

  // Ctrl-C mid-wait, or a call that throws before the tags are seen: the rows go back exactly as
  // they were (no typo'd address held, an older row's verified time not lost), nothing connected.
  it('puts the rows back when the wait is stopped or a call throws', async () => {
    const old: Row = { provider: 'google', site_url: 'https://old.example/', code: 'oldCode', verified_at: 'earlier', error_code: 'google_add' }
    const stop = new AbortController()
    const mem = memStore({ rows: [old] })
    // Stopped while sleeping between looks; a sleep that never ends proves the stop doesn't wait it out.
    const out = await registerSite(ARTIST, SITE, deps(mem, { signal: stop.signal, fetchHome: async () => page(null, null), sleep: () => (stop.abort(), new Promise(() => {})) }))
    expect(out).toMatchObject({ ok: false, connected: false, verified: [] })
    expect(out.steps.at(-1)).toMatchObject({ ok: false, reason: 'interrupted' })
    expect([...mem.rows.values()]).toEqual([old])
    expect(mem.events.some((e) => e.startsWith('connect') || e.includes(' verify'))).toBe(false)

    const mem2 = memStore({ rows: [old] })
    await expect(registerSite(ARTIST, SITE, deps(mem2, { fetchHome: async () => { throw new Error('dns down') } }))).rejects.toThrow('dns down')
    expect([...mem2.rows.values()]).toEqual([old])
  })

  // A row that existed before this run is kept (it may be live elsewhere) and marked not_live.
  it('removes nothing when every row predates the run', async () => {
    const mem = memStore({ rows: [
      { provider: 'google', site_url: SITE, code: G, verified_at: 'earlier', error_code: null },
      { provider: 'bing', site_url: SITE, code: B, verified_at: 'earlier', error_code: null },
    ] })
    await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => page(null, null) }))
    expect(mem.events.some((e) => e.startsWith('remove'))).toBe(false)
    expect(mem.rows.size).toBe(2)
  })

  // A row that existed before this run is kept (it may be live elsewhere) and marked not_live.
  it('keeps an older row but marks it not_live', async () => {
    const mem = memStore({ rows: [{ provider: 'bing', site_url: SITE, code: B, verified_at: 'earlier', error_code: null }] })
    await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => page(null, null) }))
    expect([...mem.rows.keys()]).toEqual(['bing'])
    expect(mem.rows.get('bing')).toMatchObject({ error_code: 'not_live', verified_at: 'earlier' })
  })

  // "Try again": the same codes keep their verified state; a new code resets it until re-verified.
  it('reruns cleanly: same code keeps verified_at, a changed code resets it', async () => {
    const mem = memStore({ rows: [
      { provider: 'google', site_url: SITE, code: G, verified_at: 'earlier', error_code: 'google_add' },
      { provider: 'bing', site_url: SITE, code: '0'.repeat(32), verified_at: 'earlier', error_code: null },
    ] })
    let seen: Row[] = []
    const d = deps(mem, { fetchHome: async () => {
      seen = await mem.store.rowsOf(ARTIST)
      return page(G, B)
    } })
    await registerSite(ARTIST, SITE, d)
    expect(seen.find((r) => r.provider === 'google')).toMatchObject({ verified_at: 'earlier', error_code: null })
    expect(seen.find((r) => r.provider === 'bing')).toMatchObject({ code: B, verified_at: null })
  })

  // Same code at a NEW address (the site moved) also un-verifies until it is verified there.
  it('resets a row whose address changed, even with the same code', async () => {
    const mem = memStore({ rows: [{ provider: 'google', site_url: 'https://old.example/', code: G, verified_at: 'earlier', error_code: null }] })
    let seen: Row[] = []
    await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => {
      seen = await mem.store.rowsOf(ARTIST)
      return page(G, B)
    } }))
    expect(seen.find((r) => r.provider === 'google')).toMatchObject({ site_url: SITE, verified_at: null })
  })

  // Another artist already holds this address: stop before any code is made or stored.
  it('stops when another artist holds the address', async () => {
    const mem = memStore({ holder: 'artist-b' })
    const out = await registerSite(ARTIST, SITE, deps(mem))
    expect(out).toMatchObject({ ok: false })
    expect(out.steps.at(-1)).toMatchObject({ step: 'address free', ok: false, reason: 'address_taken', detail: 'already registered to artist artist-b' })
    expect(mem.events).toEqual([])
  })

  // A bad or unreachable address: nothing is asked of Google or Bing.
  it('stops on a bad address', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, 'http://x', deps(mem, { resolveAddress: async () => ({ ok: false, reason: 'bad_address' }) }))
    expect(out).toMatchObject({ ok: false, siteUrl: null, connected: false })
    expect(out.steps).toEqual([{ step: 'address', ok: false, reason: 'bad_address' }])
    expect(mem.events).toEqual([])
  })

  // Google refusing never stops Bing, and the refusal is stored as its code.
  it('carries on with Bing when Google fails, and stores Google’s reason', async () => {
    // Verified on an earlier run, same code and address: a refused verify still un-verifies it.
    const mem = memStore({ rows: [{ provider: 'google', site_url: SITE, code: G, verified_at: 'earlier', error_code: null }] })
    const out = await registerSite(ARTIST, SITE, deps(mem, {}, { google: { verify: () => ({ ok: false, reason: 'google_verify', detail: 'token not found' }) } }))
    expect(out).toMatchObject({ ok: false, verified: ['bing'] })
    expect(mem.rows.get('google')).toMatchObject({ verified_at: null, error_code: 'google_verify' })
    expect(out.steps.find((st) => st.step === 'google verified')).toEqual({ step: 'google verified', ok: false, reason: 'google_verify', detail: 'token not found' })
    expect(mem.rows.get('bing')).toMatchObject({ verified_at: 'now', error_code: null })
    expect(mem.events).not.toContain('google addSite')
  })

  // Ownership proven but the sitemap refused: verified, with the reason kept for a retry.
  it('counts a verified site as verified even if its sitemap is refused', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, {}, { bing: { feed: () => ({ ok: false, reason: 'bing_feed' }) } }))
    expect(out.verified).toEqual(['google', 'bing'])
    expect(out.ok).toBe(false)
    expect(mem.rows.get('bing')).toMatchObject({ verified_at: 'now', error_code: 'bing_feed' })
  })

  // A site already on the Bing account: AddSite is refused (AlreadyExists), the code is still read.
  it('goes on with Bing when AddSite is refused but the code is there', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, {}, { bing: { addSite: () => ({ ok: false, reason: 'bing_add', detail: 'AlreadyExists' }) } }))
    expect(out.verified).toEqual(['google', 'bing'])
    expect(out.steps.find((st) => st.step === 'bing code')).toEqual({ step: 'bing code', ok: true })
  })

  // Both refused: AddSite's reason is the one shown (it came first and explains the rest).
  it('shows AddSite’s reason when neither AddSite nor the code works', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => page(G, null) }, { bing: { addSite: () => ({ ok: false, reason: 'bing_auth' }), code: () => ({ ok: false, reason: 'bing_code' }) } }))
    expect(out.steps.find((st) => st.step === 'bing code')).toMatchObject({ ok: false, reason: 'bing_auth' })
  })

  // Bing's code refused (AddSite fine, no code): Bing is left out, never stored with no code.
  it('leaves Bing out when it gives no code', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, { fetchHome: async () => page(G, null) }, { bing: { code: () => ({ ok: false, reason: 'bing_code' }) } }))
    expect([...mem.rows.keys()]).toEqual(['google'])
    expect(out.steps.find((st) => st.step === 'bing code')).toMatchObject({ ok: false, reason: 'bing_code' })
    expect(mem.events).not.toContain('bing verify')
  })

  // Moved to a new address, and Bing gave no code this run (or isn't set up): the Bing row would
  // still say "verified at the OLD address", so the Search tab and the AI test would ask Bing about
  // a site the artist left, and unique(provider, site_url) would keep the old address blocked on
  // Bing for every other artist. Once the new address is live it goes. At the SAME address it
  // stays (Bing just didn't answer this run), and a run that never goes live touches nothing.
  it('drops a Bing row left at the old address once the new one is live, and only then', async () => {
    const OLD = 'https://old.example/'
    const was = (site_url: string): Row[] => [
      { provider: 'google', site_url, code: G, verified_at: 'earlier', error_code: null },
      { provider: 'bing', site_url, code: B, verified_at: 'earlier', error_code: null },
    ]
    const noCode = (m: ReturnType<typeof memStore>, extra: Partial<RegisterDeps> = {}) =>
      deps(m, { fetchHome: async () => (m.events.push('look'), page(G, null)), ...extra }, { bing: { code: () => ({ ok: false, reason: 'bing_code' }) } })
    const notSetUp = (m: ReturnType<typeof memStore>, extra: Partial<RegisterDeps> = {}) => deps(m, { bing: null, fetchHome: async () => (m.events.push('look'), page(G, null)), ...extra })
    for (const run of [noCode, notSetUp]) {
      const moved = memStore({ rows: was(OLD) })
      await registerSite(ARTIST, SITE, run(moved))
      expect([...moved.rows.keys()], run.name).toEqual(['google'])
      expect(moved.rows.get('google'), run.name).toMatchObject({ site_url: SITE, verified_at: 'now' })
      expect(moved.events.indexOf('remove bing'), run.name).toBeGreaterThan(moved.events.indexOf('look'))

      const same = memStore({ rows: was(SITE) })
      await registerSite(ARTIST, SITE, run(same))
      expect(same.rows.get('bing'), run.name).toEqual(was(SITE)[1])

      const never = memStore({ rows: was(OLD) })
      await registerSite(ARTIST, SITE, run(never, { fetchHome: async () => page(null, null) }))
      expect(never.rows.get('bing'), run.name).toEqual(was(OLD)[1])
    }
  })

  // Google's code is made for this site alone; Bing's is the same on every site of the account, so
  // another artist's page showing it proves nothing. No Google code (no key, or Google refused):
  // nothing stored, Bing not asked, nothing connected.
  it('stops before storing anything without Google’s code', async () => {
    for (const d of [
      (m: ReturnType<typeof memStore>) => deps(m, { fetchHome: async () => page(null, B) }, { google: { token: () => ({ ok: false, reason: 'google_auth', detail: 'bad key' }) } }),
      (m: ReturnType<typeof memStore>) => deps(m, { google: null, fetchHome: async () => page(null, B) }),
    ]) {
      const mem = memStore()
      const out = await registerSite(ARTIST, SITE, d(mem))
      expect(out).toMatchObject({ ok: false, connected: false, verified: [] })
      expect(out.steps.at(-1)).toMatchObject({ ok: false, reason: 'no_google_code' })
      expect(mem.events.filter((e) => e !== 'google token')).toEqual([])
      expect(mem.rows.size).toBe(0)
    }
  })

  // A provider with no credentials is skipped entirely, and the other runs on its own.
  it('skips Bing when it isn’t set up', async () => {
    const mem = memStore()
    const out = await registerSite(ARTIST, SITE, deps(mem, { bing: null, fetchHome: async () => page(G, null) }))
    expect(out).toMatchObject({ ok: true, verified: ['google'] })
    expect(mem.events.some((e) => e.startsWith('bing'))).toBe(false)
  })

  // Skeen is already connected at this address (the column has no trailing slash, or has one;
  // any case): not rewritten.
  it('doesn’t rewrite an artist already connected at this address', async () => {
    for (const url of ['https://www.skeenmusic.com', 'https://www.skeenmusic.com/', 'https://www.skeenmusic.com//', 'https://WWW.SkeenMusic.com']) {
      const mem = memStore({ site: { site_kind: 'custom', custom_site_url: url } })
      const out = await registerSite(ARTIST, SITE, deps(mem))
      expect(out.connected, url).toBe(true)
      expect(mem.events.some((e) => e.startsWith('connect')), url).toBe(false)
      expect(out.steps.find((st) => st.step === 'already connected to the artist'), url).toBeDefined()
    }
  })

  // Connected elsewhere, or on the built-in template at this address: connected to THIS site.
  it('connects an artist whose site is elsewhere or not custom', async () => {
    for (const site of [{ site_kind: 'custom', custom_site_url: 'https://old.example' }, { site_kind: 'template', custom_site_url: 'https://www.skeenmusic.com' }, { site_kind: null, custom_site_url: null }, null]) {
      const mem = memStore({ site: site as never })
      if (site === null) mem.store.siteOf = async () => null
      await registerSite(ARTIST, SITE, deps(mem))
      expect(mem.site(), JSON.stringify(site)).toEqual({ site_kind: 'custom', custom_site_url: 'https://www.skeenmusic.com' })
    }
  })

  // The real pace, with nothing injected: a look every 10 s, never a tight loop against the site.
  describe('the default pace', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // Six or seven looks in a minute: the wait for the tags never turns into a tight loop against the site.
    it('looks at most every 10 seconds', async () => {
      vi.useFakeTimers()
      const mem = memStore()
      let looks = 0
      const d = deps(mem, { fetchHome: async () => (looks++, page(null, null)) })
      delete d.sleep
      delete d.now
      delete d.pollMs
      const run = registerSite(ARTIST, SITE, d)
      await vi.advanceTimersByTimeAsync(61_000)
      await run
      expect(looks).toBeLessThanOrEqual(7)
      expect(looks).toBeGreaterThanOrEqual(6)
    })
  })
})
