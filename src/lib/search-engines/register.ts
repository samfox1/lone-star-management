/**
 * REGISTER A SITE with Google and Bing, as Tapir (ADD_WEBSITE_PLAN.md "How it works", step 4).
 *
 *   1. Address   the live site decides (address.ts): https://www.example.com/
 *   2. Taken?    another artist already registered under it → stop
 *   3. Codes     Google's META token; Bing: AddSite, then this site's AuthenticationCode
 *   4. Store     upsert both into site_verifications (the SERVICE client: the table is closed to
 *                every signed-in user, admins included); get_public_site serves them at once
 *   5. Live?     read the home page until both <meta> tags are there (ISR: about a minute)
 *                Not there in time → the rows THIS run created are removed (a typo or the wrong
 *                artist must not keep holding the address), and it stops.
 *   6. Connect   the site is attached to the artist only now, after THIS artist's GOOGLE code
 *                was seen on it (different for every site, checked live 2026-09-30; Bing's is the same on every site of
 *                the account, so it proves nothing about which artist). Before verify: the live
 *                page is the proof, verify only asks Google and Bing to look too.
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
}

export type StepResult = { step: string; ok: boolean; reason?: string; detail?: string }
export type RegisterOutcome = { ok: boolean; siteUrl: string | null; steps: StepResult[]; verified: Provider[]; connected: boolean }

/** `name → content` of every <meta> in the page's <head> (where Google and Bing look), attribute
 *  order, quote style and case ignored. */
export function metaTags(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const head = html.split(/<\/head\s*>/i)[0]
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
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

  // 3. Codes
  const codes: Partial<Record<Provider, string>> = {}
  if (deps.google) {
    const g = await deps.google.getMetaToken(siteUrl)
    if (g.ok) codes.google = g.value
    say({ step: 'google code', ok: g.ok, ...(g.ok ? {} : { reason: g.reason, detail: g.detail }) })
  }
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
  if (!providers.length) return done(false, siteUrl)

  // 4. Store (a changed code or address un-verifies the row until it is verified again)
  const before = new Map((await deps.store.rowsOf(artistId)).map((r) => [r.provider, r]))
  const created = providers.filter((p) => !before.has(p))
  await deps.store.upsert(
    artistId,
    providers.map((p) => ({ provider: p, site_url: siteUrl, code: codes[p]!, reset: before.get(p)?.code !== codes[p] || before.get(p)?.site_url !== siteUrl })),
  )
  say({ step: `stored ${providers.join(' + ')}`, ok: true })

  // 5. Live?
  const waitMs = deps.waitMs ?? 300_000
  const pollMs = deps.pollMs ?? 10_000
  const until = now() + waitMs
  let live = false
  for (;;) {
    live = tagsLive(await deps.fetchHome(siteUrl), codes)
    if (live || now() >= until) break
    await sleep(pollMs)
  }
  if (!live) {
    // Leave nothing on an address this run couldn't prove: remove what it created, and put older
    // rows back exactly as they were (a rerun with a typo mustn't move them), marked not_live.
    if (created.length) await deps.store.remove(artistId, created)
    const older = providers.filter((q) => !created.includes(q)).map((q) => ({ ...before.get(q)!, error_code: 'not_live' }))
    if (older.length) await deps.store.restore(artistId, older)
    say({ step: 'tags live on the site', ok: false, reason: 'not_live', detail: `not seen within ${Math.round(waitMs / 1000)} s` })
    return done(false, siteUrl)
  }
  say({ step: 'tags live on the site', ok: true })

  // 6. Connect, now that this artist's codes are on the site. Only Google's code proves WHICH
  //    artist the site serves: it is made for this site alone, while Bing's is the same on every
  //    site of the account. So without Google's code seen live, nothing is connected.
  const origin = siteUrl.replace(/\/$/, '')
  const current = await deps.store.siteOf(artistId)
  const already = current?.site_kind === 'custom' && (current.custom_site_url ?? '').replace(/\/+$/, '').toLowerCase() === origin
  let connected = already
  if (already) say({ step: 'already connected to the artist', ok: true })
  else if (!codes.google) say({ step: 'connect', ok: false, reason: 'no_google_proof', detail: 'only Google’s code proves which artist a site serves' })
  else {
    await deps.store.connect(artistId, origin)
    connected = true
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
  if (codes.google && deps.google) {
    const g = deps.google
    await finish('google', [() => g.verify(siteUrl, deps.owners), () => g.addSite(siteUrl), () => g.submitSitemap(siteUrl, sitemap)], ['verified', 'property added', 'sitemap sent'])
  }
  if (codes.bing && deps.bing) {
    const b = deps.bing
    await finish('bing', [() => b.verify(siteUrl), () => b.submitFeed(siteUrl, sitemap)], ['verified', 'sitemap sent'])
  }
  // ok only when every step went through (a provider verified but its sitemap refused is not ok).
  return done(steps.every((st) => st.ok), siteUrl, verified, connected)
}
