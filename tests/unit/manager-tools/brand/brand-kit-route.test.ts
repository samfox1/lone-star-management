// The brand-kit download route: who gets a zip, and what is in it.
/**
 * GET /artists/[id]/brand/kit (BRAND_PAGE_PLAN.md, "Brand kit"): a zip of what is LIVE on
 * the site — the published logos, the tab and home-screen icons, the font files for
 * published slots — plus colors.txt from the PUBLISHED palette (the door's `brand.colors`).
 *
 * The Supabase client is the PostgREST-shaped fake (`_fake-client.ts`) and storage is a
 * stubbed global `fetch`, so what this file pins is the route's DECISIONS: the ownership
 * gate, that the published door (not the working rows) decides what ships, the names the
 * zip entries get, and the size cap. The zip itself is unzipped with fflate's own reader,
 * so the assertions are on real zip bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { fakeClient, isOwnershipRead, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const ORIGIN = 'https://proj.example'

let fake: ReturnType<typeof fakeClient>
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fake.client }))

import { GET } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/route'

type DoorMedia = { id: string; purpose: string; path: string; label?: string | null }
type DoorFont = { family: string; label: string; path: string | null; format: string | null; source?: string; google_family?: string }
type DoorColor = { key: string; name: string; hex: string }
type Door = { media: DoorMedia[]; fonts: DoorFont[]; font_slots: Record<string, string>; brand?: { colors: DoorColor[] } } | null

/** What the live site shows: the published door's payload. */
const PUBLISHED: NonNullable<Door> = {
  media: [
    { id: 'm-p', purpose: 'logo_primary', path: 'a1/brand/primary.png' },
    { id: 'm-s', purpose: 'logo_secondary', path: 'a1/brand/secondary.webp' },
    { id: 'm-f', purpose: 'favicon', path: 'a1/brand/tab.png' },
    { id: 'm-h', purpose: 'home_icon', path: 'a1/brand/home.png' },
    { id: 'm-l', purpose: 'logo', path: 'a1/brand/tour.png', label: 'Tour logo' },
    // Published, but not brand: a gallery photo must never ride along.
    { id: 'm-g', purpose: 'gallery_image', path: 'a1/gallery/photo.jpg' },
  ],
  fonts: [
    { family: 'skeen-display', label: 'Skeen Display', path: 'a1/fonts/display.woff2', format: 'woff2' },
    // Published but in NO slot: the plan ships "font files for published slots" only.
    { family: 'spare', label: 'Spare', path: 'a1/fonts/spare.ttf', format: 'ttf' },
  ],
  font_slots: { primary: 'skeen-display' },
  brand: {
    colors: [
      { key: 'primary', name: 'Ink', hex: '#0d0d0d' },
      { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
    ],
  },
}

/** A logo added on the dashboard and never published — the planted witness. */
const DRAFT_LOGO = { id: 'm-d', purpose: 'logo', label: 'Draft logo', storage_path: 'a1/brand/draft.png', note: null }

/** The WORKING palette: Ink renamed and a colour added, neither published — the planted
 *  witness that colors.txt reads the door, like every other file in the kit. */
const COLORS = [
  { id: 'c1', key: 'primary', name: 'Ink (draft)', hex: '#111111', note: null, sort_order: 0 },
  { id: 'c2', key: 'cream', name: 'Cream', hex: '#f4f1ea', note: null, sort_order: 1 },
  { id: 'c3', key: 'draft-pink', name: 'Draft pink', hex: '#ff00aa', note: null, sort_order: 2 },
]

function world({
  owner = true,
  slug = 'lone-pine',
  door = PUBLISHED as Door,
  colors = COLORS as unknown[],
}: { owner?: boolean; slug?: string; door?: Door; colors?: unknown[] } = {}) {
  fake = fakeClient((call: Call): Reply => {
    if (isOwnershipRead(call)) return { data: owner ? { id: 'a1' } : null }
    if (call.table === 'artists') return { data: owner ? { slug } : null }
    if (call.op === 'rpc' && call.table === 'get_public_site') return { data: door }
    if (call.table === 'brand_colors') return { data: owner ? colors : [] }
    // The WORKING media rows: the draft logo is here, and only here.
    if (call.table === 'media') return { data: [DRAFT_LOGO] }
    return { data: [] }
  })
}

/** Storage: every object answers with bytes naming its own path, unless told otherwise. */
let objects: Map<string, Uint8Array<ArrayBuffer> | 'missing'>
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const prefix = `${ORIGIN}/storage/v1/object/public/`
  const key = url.startsWith(prefix) ? url.slice(prefix.length) : url
  const hit = objects.get(key)
  if (hit === 'missing') return new Response('not found', { status: 404 })
  return new Response(hit ?? new TextEncoder().encode(key))
})
const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]))

const call = (id = 'a1') => GET(new Request(`http://x/artists/${id}/brand/kit`), { params: Promise.resolve({ id }) })
const unzip = async (res: Response) => unzipSync(new Uint8Array(await res.arrayBuffer()))

beforeEach(() => {
  objects = new Map()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ORIGIN)
  vi.stubGlobal('fetch', fetchMock)
  world()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('brand kit route — who gets a zip', () => {
  it('CRITICAL: a caller who does not own the artist gets a 404 and NO bytes — nothing is read or fetched', async () => {
    world({ owner: false })
    const res = await call()
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).not.toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBeNull()
    // Not one storage object, not the door, not the palette: the gate is FIRST.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.calls.some((c) => c.table === 'brand_colors')).toBe(false)
    // The gate is the SAME ownership read the brand actions make (callerOwns).
    expect(fake.calls.some(isOwnershipRead)).toBe(true)
  })

  it('an owner gets a fresh zip download named after the artist, never cached', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="lone-pine-brand-kit.zip"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // It really is a zip.
    expect(Object.keys(await unzip(res)).length).toBeGreaterThan(0)
  })
})

describe('brand kit route — only what is live on the site', () => {
  it('CRITICAL: ships exactly the published brand items; a planted draft logo is absent', async () => {
    // Witness first (AGENTS.md rule 2): the draft really is in the working rows, so its
    // absence below means the route chose not to ship it — not that there was none.
    const { data: working } = await fake.client.from('media').select('id, purpose, label, storage_path').eq('artist_id', 'a1')
    expect(working).toEqual([DRAFT_LOGO])
    fake.calls.length = 0

    const entries = await unzip(await call())
    expect(Object.keys(entries).sort()).toEqual(
      [
        'colors.txt',
        'font-skeen-display.woff2',
        'home-screen-icon.png',
        'logo-primary.png',
        'logo-secondary.webp',
        'logo-tour-logo.png',
        'tab-icon.png',
      ].sort(),
    )
    // Each entry carries the bytes of ITS object, not a neighbour's.
    expect(strFromU8(entries['logo-primary.png'])).toBe('media/a1/brand/primary.png')
    expect(strFromU8(entries['tab-icon.png'])).toBe('media/a1/brand/tab.png')
    expect(strFromU8(entries['font-skeen-display.woff2'])).toBe('fonts/a1/fonts/display.woff2')

    // The draft, the gallery photo and the unslotted font were never even fetched.
    expect(fetched().some((u) => u.includes('draft.png'))).toBe(false)
    expect(fetched().some((u) => u.includes('gallery/photo.jpg'))).toBe(false)
    expect(fetched().some((u) => u.includes('spare.ttf'))).toBe(false)
  })

  it('reads the objects from the PUBLIC buckets, server-side (media and fonts)', async () => {
    await call()
    expect(fetched()).toContain(`${ORIGIN}/storage/v1/object/public/media/a1/brand/primary.png`)
    expect(fetched()).toContain(`${ORIGIN}/storage/v1/object/public/fonts/a1/fonts/display.woff2`)
  })

  it('a font that fills two slots ships once', async () => {
    world({ door: { ...PUBLISHED, font_slots: { primary: 'skeen-display', custom_1: 'skeen-display' } } })
    const entries = await unzip(await call())
    expect(Object.keys(entries).filter((n) => n.startsWith('font-'))).toEqual(['font-skeen-display.woff2'])
    expect(fetched().filter((u) => u.includes('display.woff2'))).toHaveLength(1)
  })

  it('a published path outside this artist\'s folder is never fetched', async () => {
    world({
      door: {
        ...PUBLISHED,
        media: [{ id: 'x', purpose: 'logo_primary', path: 'someone-else/brand/primary.png' }],
      },
    })
    const res = await call()
    expect(fetched().some((u) => u.includes('someone-else'))).toBe(false)
    expect(Object.keys(await unzip(res))).not.toContain('logo-primary.png')
  })

  it('with nothing published yet, the kit is an empty colors.txt and a note saying so', async () => {
    world({ door: null })
    const entries = await unzip(await call())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(Object.keys(entries).sort()).toEqual(['colors.txt', 'skipped.txt'])
    // The draft palette has three colours; none of them is on the site.
    expect(strFromU8(entries['colors.txt'])).toBe('')
    expect(strFromU8(entries['skipped.txt'])).toMatch(/nothing is on the site yet/i)
  })
})

describe('brand kit route — names', () => {
  it('CRITICAL: a hostile or accented logo title becomes a flat, safe entry name', async () => {
    world({
      door: {
        media: [
          { id: 'l1', purpose: 'logo', path: 'a1/brand/one.png', label: '../../etc/passwd\u0007' },
          { id: 'l2', purpose: 'logo', path: 'a1/brand/two.png', label: 'Café Noir' },
          { id: 'l3', purpose: 'logo', path: 'a1/brand/three.png', label: '///' },
        ],
        fonts: [],
        font_slots: {},
      },
    })
    const names = Object.keys(await unzip(await call()))
    for (const n of names) {
      expect(n).toMatch(/^[a-z0-9.-]+$/)
      expect(n.includes('..')).toBe(false)
    }
    expect(names).toContain('logo-etc-passwd.png')
    expect(names).toContain('logo-cafe-noir.png')
    // Nothing printable survives "///": the entry still gets a name, not "logo-.png".
    expect(names).toContain('logo-added.png')
  })

  it('two logos with the same title keep their extensions: tour.png, tour-2.png', async () => {
    world({
      door: {
        media: [
          { id: 'l1', purpose: 'logo', path: 'a1/brand/one.png', label: 'Tour' },
          { id: 'l2', purpose: 'logo', path: 'a1/brand/two.png', label: 'Tour' },
        ],
        fonts: [],
        font_slots: {},
      },
    })
    const entries = await unzip(await call())
    expect(strFromU8(entries['logo-tour.png'])).toBe('media/a1/brand/one.png')
    expect(strFromU8(entries['logo-tour-2.png'])).toBe('media/a1/brand/two.png')
  })

  it('the download filename is built from a sanitized slug', async () => {
    world({ slug: 'Lone "Pine"\r\nX' })
    const res = await call()
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="lone-pine-x-brand-kit.zip"')
  })
})

describe('brand kit route — colors.txt', () => {
  it('CRITICAL: colors.txt is the PUBLISHED palette, one line per colour — the draft palette never ships', async () => {
    // Witness first: the working palette really differs (a rename and an added colour), so
    // the published lines below mean the route chose the door, not that the two agreed.
    const { data: working } = await fake.client.from('brand_colors').select('name, hex').eq('artist_id', 'a1')
    expect(working).toEqual(COLORS)
    fake.calls.length = 0

    const entries = await unzip(await call())
    expect(strFromU8(entries['colors.txt'])).toBe('Ink, #0d0d0d, RGB 13, 13, 13\nCream, #f4f1ea, RGB 244, 241, 234\n')
    expect(fake.calls.some((c) => c.table === 'brand_colors')).toBe(false)
  })

  it('a site with no colours published: colors.txt is empty and skipped.txt says why', async () => {
    world({ door: { ...PUBLISHED, brand: { colors: [] } } })
    const entries = await unzip(await call())
    expect(strFromU8(entries['colors.txt'])).toBe('')
    expect(strFromU8(entries['skipped.txt'])).toBe('colors.txt: no colours are on the site yet.\n')
  })
})

describe('brand kit route — what it leaves out, and says so', () => {
  it('a missing object is skipped and reported; the rest still ships', async () => {
    objects.set('media/a1/brand/secondary.webp', 'missing')
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-secondary.webp')
    const entries = await unzip(res)
    expect(entries['logo-secondary.webp']).toBeUndefined()
    expect(entries['logo-primary.png']).toBeDefined()
    expect(strFromU8(entries['skipped.txt'])).toMatch(/^logo-secondary\.webp: /m)
  })

  it('CRITICAL: the total is capped — an object that would overflow is skipped and reported, smaller ones still fit', async () => {
    const { MAX_KIT_BYTES } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/kit-entries')
    objects.set('media/a1/brand/primary.png', new Uint8Array(MAX_KIT_BYTES + 1))
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-primary.png')
    const entries = await unzip(res)
    expect(entries['logo-primary.png']).toBeUndefined()
    expect(strFromU8(entries['skipped.txt'])).toMatch(/^logo-primary\.png: too large/m)
    // Everything after it still fit.
    expect(entries['tab-icon.png']).toBeDefined()
    expect(entries['font-skeen-display.woff2']).toBeDefined()
  })

  it('nothing skipped: no skipped.txt and no header', async () => {
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBeNull()
    expect(Object.keys(await unzip(res))).not.toContain('skipped.txt')
  })

  it('CRITICAL: the cap is a RUNNING total — two objects that each fit alone do not both fit together', async () => {
    // The single-oversized-object test above passes whether the limit handed to each fetch
    // is "what is left" or the whole cap. Two 60%-of-cap logos tell them apart: the second
    // must be left out, or the response body passes the platform limit and the whole
    // download is refused.
    const { MAX_KIT_BYTES } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/kit-entries')
    const big = Math.floor(MAX_KIT_BYTES * 0.6)
    objects.set('media/a1/brand/primary.png', new Uint8Array(big))
    objects.set('media/a1/brand/secondary.webp', new Uint8Array(big))
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-secondary.webp')
    const entries = await unzip(res)
    expect(entries['logo-primary.png']).toHaveLength(big)
    expect(entries['logo-secondary.webp']).toBeUndefined()
    expect(entries['tab-icon.png']).toBeDefined() // small ones after it still fit
  })

  it('a DECLARED length over the cap is refused before a single byte is read', async () => {
    // The streaming check would catch it too, but only after buffering up to the cap —
    // the header check is what keeps a huge object from being read at all.
    const { MAX_KIT_BYTES } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/kit-entries')
    let pulled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true
          controller.enqueue(new Uint8Array(MAX_KIT_BYTES + 1))
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    fetchMock.mockImplementationOnce(async () => new Response(body, { headers: { 'content-length': String(MAX_KIT_BYTES + 1) } }))
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-primary.png')
    expect(strFromU8((await unzip(res))['skipped.txt'])).toMatch(/^logo-primary\.png: too large/m)
    expect(pulled).toBe(false)
  })

  it('a Google font in a published slot is listed in skipped.txt with where to get it; the header names it too', async () => {
    world({
      door: {
        ...PUBLISHED,
        fonts: [...PUBLISHED.fonts, { family: 'archivo', label: 'Archivo', path: null, format: null, source: 'google', google_family: 'Archivo' }],
        font_slots: { primary: 'skeen-display', secondary: 'archivo' },
      },
    })
    const res = await call()
    expect(strFromU8((await unzip(res))['skipped.txt'])).toBe('font-archivo: a Google font, get Archivo from fonts.google.com\n')
    expect(res.headers.get('x-brand-kit-skipped')).toBe('font-archivo')
    expect(fetched().some((u) => u.includes('null'))).toBe(false)
  })

  it('CRITICAL: a door that errors is a 502, not a kit claiming nothing is on the site', async () => {
    fake = fakeClient((c: Call): Reply => {
      if (isOwnershipRead(c)) return { data: { id: 'a1' } }
      if (c.table === 'artists') return { data: { slug: 'lone-pine' } }
      if (c.op === 'rpc') return { error: { message: 'statement timeout' } }
      if (c.table === 'brand_colors') return { data: COLORS }
      return { data: [] }
    })
    const res = await call()
    expect(res.status).toBe(502)
    expect(res.headers.get('content-type')).not.toBe('application/zip')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('brand kit route — single-occupancy slots', () => {
  it('a stray second primary logo in the door ships ONCE, and it is the newest (the last) one', async () => {
    world({
      door: {
        ...PUBLISHED,
        media: [
          { id: 'old', purpose: 'logo_primary', path: 'a1/brand/old-primary.png' },
          { id: 'new', purpose: 'logo_primary', path: 'a1/brand/new-primary.png' },
        ],
      },
    })
    const entries = await unzip(await call())
    expect(Object.keys(entries).filter((n) => n.startsWith('logo-primary'))).toEqual(['logo-primary.png'])
    expect(strFromU8(entries['logo-primary.png'])).toBe('media/a1/brand/new-primary.png')
  })
})

describe('brand kit route — the edges a mutation run found unwatched (2026-09-23)', () => {
  const doorWorld = (reply: (c: Call) => Reply | undefined) => {
    fake = fakeClient((c: Call): Reply => {
      if (isOwnershipRead(c)) return { data: { id: 'a1' } }
      return reply(c) ?? { data: [] }
    })
  }

  it('the slug is read for THIS artist and handed to the door; a vanished row is a 404 with no body to speak of', async () => {
    await call()
    const slugRead = fake.calls.find((c) => c.table === 'artists' && c.cols === 'slug')!
    expect(slugRead.filters).toEqual([['eq', 'id', 'a1']])
    expect(fake.calls.find((c) => c.op === 'rpc')!.args).toEqual({ p_slug: 'lone-pine' })

    // Owned a moment ago, gone now (deleted in another tab): not a crash, a 404.
    doorWorld((c) => (c.table === 'artists' ? { data: null } : undefined))
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Not found')
  })

  it('an artist with no slug still downloads, as "artist-brand-kit.zip"', async () => {
    doorWorld((c) => (c.table === 'artists' ? { data: { slug: null } } : c.op === 'rpc' ? { data: null } : undefined))
    const res = await call()
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="artist-brand-kit.zip"')
    expect(fake.calls.find((c) => c.op === 'rpc')!.args).toEqual({ p_slug: '' })
  })

  it('the 502 says what went wrong', async () => {
    doorWorld((c) => (c.table === 'artists' ? { data: { slug: 'lone-pine' } } : c.op === 'rpc' ? { error: { message: 'x' } } : undefined))
    expect(await (await call()).json()).toEqual({ error: 'Could not read the site.' })
  })

  it('objects are fetched uncached and with a timeout', async () => {
    await call()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('a path outside this artist\u2019s folder is listed in skipped.txt and the header, with the reason', async () => {
    world({ door: { ...PUBLISHED, media: [{ id: 'x', purpose: 'logo_primary', path: 'someone-else/brand/primary.png' }] } })
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-primary')
    expect(strFromU8((await unzip(res))['skipped.txt'])).toBe('logo-primary: not a file of this artist\n')
  })

  it('two left out: the header lists both, comma-separated; each line says why', async () => {
    objects.set('media/a1/brand/secondary.webp', 'missing')
    objects.set('media/a1/brand/tab.png', 'missing')
    const res = await call()
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-secondary.webp, tab-icon.png')
    expect(strFromU8((await unzip(res))['skipped.txt'])).toBe(
      'logo-secondary.webp: missing from storage\ntab-icon.png: missing from storage\n',
    )
  })

  it('a fetch that throws (a timeout, a dropped connection) is left out as "could not be fetched"', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('aborted')
    })
    const res = await call()
    expect(strFromU8((await unzip(res))['skipped.txt'])).toBe('logo-primary.png: could not be fetched\n')
  })

  it('an object streamed in several chunks arrives whole, byte for byte — and a tiny one too', async () => {
    const parts = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (const p of parts) c.enqueue(p)
              c.close()
            },
          }),
        ),
    )
    objects.set('media/a1/brand/tab.png', new Uint8Array([9]))
    const entries = await unzip(await call())
    expect([...entries['logo-primary.png']]).toEqual([1, 2, 3, 4, 5, 6])
    expect([...entries['tab-icon.png']]).toEqual([9])
  })

  it('a declared length UNDER the cap is fetched like any other', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(new Uint8Array([7, 7]), { headers: { 'content-length': '2' } }))
    expect([...(await unzip(await call()))['logo-primary.png']]).toEqual([7, 7])
  })

  it('CRITICAL: an object that exactly fills the cap ships; once the cap is full, the rest are not even fetched', async () => {
    const { MAX_KIT_BYTES } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/kit/kit-entries')
    objects.set('media/a1/brand/primary.png', new Uint8Array(MAX_KIT_BYTES))
    const res = await call()
    const entries = await unzip(res)
    expect(entries['logo-primary.png']).toHaveLength(MAX_KIT_BYTES)
    expect(fetched()).toEqual([`${ORIGIN}/storage/v1/object/public/media/a1/brand/primary.png`])
    expect(res.headers.get('x-brand-kit-skipped')).toBe('logo-secondary.webp, tab-icon.png, home-screen-icon.png, font-skeen-display.woff2, logo-tour-logo.png')
  })
})
