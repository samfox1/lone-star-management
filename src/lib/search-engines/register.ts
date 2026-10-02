/**
 * REGISTER A SITE with Google and Bing, as Tapir (ADD_WEBSITE_PLAN.md "How it works", step 4).
 *
 *   1. Address   the live site decides (address.ts): https://www.example.com/
 *   2. Taken?    another artist already registered under it → stop
 *   3. Codes     Google's META token; Bing: AddSite, then this site's AuthenticationCode.
 *                No Google code → stop here: it is made for this site alone (checked live
 *                2026-09-30), so it is the only proof of WHICH artist a site serves. Bing's is the
 *                same on every site of the account: another artist's page shows it too.
 *   4. Store     upsert both into site_verifications (the SERVICE client: the table is closed to
 *                every signed-in user, admins included); get_public_site serves them at once
 *   5. Live?     read the home page until both <meta> tags are there (ISR: about a minute)
 *                Until they are seen, whatever ends the run (not there in time, Ctrl-C via
 *                `signal`, a call that throws) puts the rows back as they were: a typo or the
 *                wrong artist must not keep holding the address.
 *   6. Connect   the site is attached to the artist only now, after THIS artist's Google code
 *                was seen on it. Before verify: the live page is the proof, verify only asks
 *                Google and Bing to look too.
 *   7. Google    verify (with the owner email) → add the property → send the sitemap
 *   8. Bing      verify → send the sitemap as a feed
 * Every Google and Bing call tolerates repeats, so "try again" is running it again. One
 * provider failing never stops the other; each row keeps a short reason code.
 *
 * Nothing here decides who may run it: the caller does (the CLI holds the service key; the admin
 * page, later, checks is_admin first).
 */
import type { BingClient } from './bing'
import type { GoogleClient } from './google'
import type { SiteAddress } from './address'

export type Provider = 'google' | 'bing'
export type Row = { provider: Provider; site_url: string; code: string; verified_at: string | null; error_code: string | null }

/** The database side, as small as the steps need (supabaseStore below; tests use a fake). */
export type RegisterStore = {
  /** Another artist registered under this address, if any. */
  holderOf(siteUrl: string, notArtist: string): Promise<string | null>
  rowsOf(artistId: string): Promise<Row[]>
  upsert(artistId: string, rows: { provider: Provider; site_url: string; code: string; reset: boolean }[]): Promise<void>
  remove(artistId: string, providers: Provider[]): Promise<void>
  /** Put rows back exactly as they were (a failed run must not leave them on an unproven address). */
  restore(artistId: string, rows: Row[]): Promise<void>
  /** Verified stamps verified_at; not verified CLEARS it (a refused verify on a row verified
   *  before must not keep the sitemap resend going). Either way error_code is set. */
  mark(artistId: string, provider: Provider, result: { verified: boolean; error_code: string | null }): Promise<void>
  siteOf(artistId: string): Promise<{ site_kind: string | null; custom_site_url: string | null } | null>
  connect(artistId: string, origin: string): Promise<void>
}

export type RegisterDeps = {
  store: RegisterStore
  google: Pick<GoogleClient, 'getMetaToken' | 'verify' | 'addSite' | 'submitSitemap'> | null
  bing: Pick<BingClient, 'addSite' | 'siteCode' | 'verify' | 'submitFeed'> | null
  resolveAddress: (input: string) => Promise<SiteAddress>
  /** The live home page's html, or null when it doesn't answer. */
  fetchHome: (siteUrl: string) => Promise<string | null>
  /** Who else owns every site at Google (server config, never a request). */
  owners: string[]
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** How long to wait for the tags to go live, and how often to look. */
  waitMs?: number
  pollMs?: number
  log?: (line: string) => void
  /** Stop early (the CLI's Ctrl-C). During the wait, the rows this run stored are put back first. */
  signal?: AbortSignal
}

export type StepResult = { step: string; ok: boolean; reason?: string; detail?: string }
export type RegisterOutcome = { ok: boolean; siteUrl: string | null; steps: StepResult[]; verified: Provider[]; connected: boolean }

/** `name → content` of every <meta> in the page's <head> (where Google and Bing look), attribute
 *  order, quote style and case ignored. */
export function metaTags(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const head = html.split(/<\/head\s*>/i)[0]
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    // `(?:^|\s)`, not `\b`: data-name= and data-content= are other attributes.
    const attr = (n: string) => tag.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
    const name = attr('name')
    const content = attr('content')
    if (!name || !content) continue
    const key = (name[2] ?? name[3] ?? '').toLowerCase()
    out.set(key, [...(out.get(key) ?? []), content[2] ?? content[3] ?? ''])
  }
  return out
}

const META_NAME: Record<Provider, string> = { google: 'google-site-verification', bing: 'msvalidate.01' }

/** Every code in `want` is on the page under its provider's meta name. */
export function tagsLive(html: string | null, want: Partial<Record<Provider, string>>): boolean {
  if (!html) return false
  const tags = metaTags(html)
  return (Object.entries(want) as [Provider, string][]).every(([p, code]) => (tags.get(META_NAME[p]) ?? []).includes(code))
}

export async function registerSite(artistId: string, address: string, deps: RegisterDeps): Promise<RegisterOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const steps: StepResult[] = []
  const say = (s: StepResult) => {
    steps.push(s)
    log(`${s.ok ? '✔' : '✖'} ${s.step}${s.reason ? ` (${s.reason})` : ''}${s.detail ? `: ${s.detail}` : ''}`)
  }
  const done = (ok: boolean, siteUrl: string | null, verified: Provider[] = [], connected = false): RegisterOutcome => ({ ok, siteUrl, steps, verified, connected })

  // 1. Address
  const addr = await deps.resolveAddress(address)
  if (!addr.ok) {
    const why = 'to' in addr && addr.to ? `it goes to ${addr.to}` : 'detail' in addr ? addr.detail : undefined
    say({ step: 'address', ok: false, reason: addr.reason, ...(why ? { detail: why } : {}) })
    return done(false, null)
  }
  const siteUrl = addr.siteUrl
  say({ step: `address ${siteUrl}`, ok: true })

  // 2. Taken?
  const holder = await deps.store.holderOf(siteUrl, artistId)
  if (holder) {
    say({ step: 'address free', ok: false, reason: 'address_taken', detail: `already registered to artist ${holder}` })
    return done(false, siteUrl)
  }

  // 3. Codes. Google's first, and without it nothing goes further (see the header): Bing isn't
  //    even asked, so no site is added to Tapir's Bing account for an address that can't be proven.
  const google = deps.google
  const g = google ? await google.getMetaToken(siteUrl) : null
  if (g) say({ step: 'google code', ok: g.ok, ...(g.ok ? {} : { reason: g.reason, detail: g.detail }) })
  if (!google || !g?.ok) {
    say({ step: 'stopped', ok: false, reason: 'no_google_code', detail: 'only Google’s code proves which artist a site serves (Bing’s is the same on every site)' })
    return done(false, siteUrl)
  }
  const codes: { google: string; bing?: string } = { google: g.value }
  if (deps.bing) {
    // AddSite on a site already on the account is refused (AlreadyExists); the code is what
    // matters, so it is always read, and AddSite's reason is shown only if that fails too.
    const add = await deps.bing.addSite(siteUrl)
    const b = await deps.bing.siteCode(siteUrl)
    if (b.ok) codes.bing = b.value
    const why = b.ok ? null : add.ok ? b : add
    say({ step: 'bing code', ok: b.ok, ...(why && !why.ok ? { reason: why.reason, detail: why.detail } : {}) })
  }
  const providers = Object.keys(codes) as Provider[]

  // 4. Store (a changed code or address un-verifies the row until it is verified again)
  const before = new Map((await deps.store.rowsOf(artistId)).map((r) => [r.provider, r]))
  const created = providers.filter((p) => !before.has(p))
  // Remove what this run created, and put older rows back exactly as they were (a rerun with a
  // typo mustn't move them, nor lose their verified time), with `error_code` when one is given.
  const putBack = async (error_code?: string) => {
    if (created.length) await deps.store.remove(artistId, created)
    const older = providers.filter((q) => !created.includes(q)).map((q) => ({ ...before.get(q)!, ...(error_code ? { error_code } : {}) }))
    if (older.length) await deps.store.restore(artistId, older)
  }

  // From the write until the tags are seen live, the rows sit on an address nothing has proven.
  // EVERY way out of that stretch puts them back: not live in time (marked not_live), a stop
  // (Ctrl-C), a call that throws (the upsert included: its answer can be lost after it landed).
  const STOP = Symbol('stop')
  const stopped = new Promise<typeof STOP>((r) => (deps.signal?.aborted ? r(STOP) : deps.signal?.addEventListener('abort', () => r(STOP), { once: true })))
  let live = false
  let notLive = false
  try {
    await deps.store.upsert(
      artistId,
      providers.map((p) => ({ provider: p, site_url: siteUrl, code: codes[p]!, reset: before.get(p)?.code !== codes[p] || before.get(p)?.site_url !== siteUrl })),
    )
    say({ step: `stored ${providers.join(' + ')}`, ok: true })

    // 5. Live? A stop never waits out a look or a sleep: each races it.
    const waitMs = deps.waitMs ?? 300_000
    const pollMs = deps.pollMs ?? 10_000
    const until = now() + waitMs
    for (;;) {
      if (deps.signal?.aborted) break
      const html = await Promise.race([deps.fetchHome(siteUrl), stopped])
      if (html === STOP) break
      live = tagsLive(html, codes)
      if (live || now() >= until) break
      if ((await Promise.race([sleep(pollMs), stopped])) === STOP) break
    }
    if (!live) {
      notLive = !deps.signal?.aborted
      say(notLive ? { step: 'tags live on the site', ok: false, reason: 'not_live', detail: `not seen within ${Math.round(waitMs / 1000)} s` } : { step: 'stopped', ok: false, reason: 'interrupted', detail: 'stored codes put back' })
      return done(false, siteUrl)
    }
  } finally {
    if (!live) await putBack(notLive ? 'not_live' : undefined)
  }
  say({ step: 'tags live on the site', ok: true })

  // 6. Connect, now that this artist's Google code is on the site.
  const origin = siteUrl.replace(/\/$/, '')
  const current = await deps.store.siteOf(artistId)
  const already = current?.site_kind === 'custom' && (current.custom_site_url ?? '').replace(/\/+$/, '').toLowerCase() === origin
  if (already) say({ step: 'already connected to the artist', ok: true })
  else {
    await deps.store.connect(artistId, origin)
    say({ step: `connected to the artist as ${origin}`, ok: true })
  }

  // 7–8. Verify and send the sitemap, one provider at a time
  const sitemap = `${siteUrl}sitemap.xml`
  const verified: Provider[] = []
  const finish = async (p: Provider, chain: (() => Promise<{ ok: true } | { ok: false; reason: string; detail?: string }>)[], label: string[]) => {
    for (let i = 0; i < chain.length; i++) {
      const r = await chain[i]()
      say({ step: `${p} ${label[i]}`, ok: r.ok, ...(r.ok ? {} : { reason: r.reason, detail: r.detail }) })
      if (!r.ok) {
        await deps.store.mark(artistId, p, { verified: i > 0, error_code: r.reason })
        if (i > 0) verified.push(p)
        return
      }
    }
    await deps.store.mark(artistId, p, { verified: true, error_code: null })
    verified.push(p)
  }
  await finish('google', [() => google.verify(siteUrl, deps.owners), () => google.addSite(siteUrl), () => google.submitSitemap(siteUrl, sitemap)], ['verified', 'property added', 'sitemap sent'])
  if (codes.bing && deps.bing) {
    const b = deps.bing
    await finish('bing', [() => b.verify(siteUrl), () => b.submitFeed(siteUrl, sitemap)], ['verified', 'sitemap sent'])
  }
  // ok only when every step went through (a provider verified but its sitemap refused is not ok).
  return done(steps.every((st) => st.ok), siteUrl, verified, true)
}
