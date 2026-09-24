import { NextResponse } from 'next/server'
import { strToU8 } from 'fflate'
import { buildBrandKitZip, type BrandKitFile } from '@/lib/manager-tools/brand/brand-kit'
import { listBrandColors, type BrandColor } from '@/lib/manager-tools/brand/brand-colors'
import { publicObjectUrl } from '@/lib/storage-url'
import { createClient } from '@/lib/supabase/server'
import { callerOwns } from '../../../_owns'
import { MAX_KIT_BYTES, nameSlug, planBrandKit, skippedTxt, type KitSkip, type LiveBrand } from './kit-entries'

/** A storage object that has not answered in this long is left out, not waited on. */
const FETCH_TIMEOUT_MS = 8000

/**
 * THE BRAND KIT (BRAND_PAGE_PLAN.md): a zip of what is LIVE on the site — the published
 * logos, the tab and home-screen icons, the font files for published slots — and
 * `colors.txt` from the palette. Built on click, nothing stored.
 *
 * OWNER-ONLY, by the same check every brand action makes (`callerOwns`, RLS-scoped), and
 * FIRST: a caller who cannot see this artist gets a 404 before the door, the palette or a
 * single storage object is read. The 404 does not say whether the artist exists.
 *
 * "Live" means the published door, `get_public_site` — the payload every website reads —
 * never the working rows, so a logo added on the dashboard and not yet published is not in
 * the kit. The objects come from the PUBLIC buckets over plain HTTP; no service role.
 *
 * Anything left out (a missing object, the size cap) is listed in `skipped.txt` inside the
 * zip — the download is a plain link, so the manager never sees a header — and in
 * `x-brand-kit-skipped` for anything that reads the response.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  if (!(await callerOwns(supabase, id))) return notFound()
  const { data: artist } = await supabase.from('artists').select('slug').eq('id', id).maybeSingle()
  if (!artist) return notFound()
  const slug = String((artist as { slug: unknown }).slug ?? '')

  const [door, palette] = await Promise.all([
    supabase.rpc('get_public_site', { p_slug: slug }),
    listBrandColors(supabase, id).then(
      (colors) => ({ colors, ok: true as const }),
      () => ({ colors: [] as BrandColor[], ok: false as const }),
    ),
  ])
  if (door.error) return NextResponse.json({ error: 'Could not read the site.' }, { status: 502, headers: NO_STORE })

  const live = (door.data ?? null) as LiveBrand
  const notes: string[] = []
  if (!live) notes.push('Nothing is on the site yet, so the kit holds only colors.txt.')
  if (!palette.ok) notes.push('colors.txt: the palette could not be read.')

  const plan = planBrandKit(id, live)
  const skipped: KitSkip[] = [...plan.skipped]
  const files: BrandKitFile[] = []
  let total = 0
  // One at a time, in the plan's order: the cap is a running total, and memory stays at
  // one object in flight rather than every object at once.
  for (const entry of plan.entries) {
    const got = await fetchCapped(publicObjectUrl(entry.bucket, entry.path), MAX_KIT_BYTES - total)
    if ('reason' in got) {
      skipped.push({ name: entry.name, reason: got.reason })
      continue
    }
    total += got.bytes.byteLength
    files.push({ path: entry.name, bytes: got.bytes })
  }

  if (skipped.length || notes.length) files.unshift({ path: 'skipped.txt', bytes: strToU8(skippedTxt(skipped, notes)) })
  const zip = buildBrandKitZip(
    files,
    palette.colors.map((c) => ({ name: c.name, hex: c.hex })),
  )

  return new NextResponse(Buffer.from(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${nameSlug(slug) || 'artist'}-brand-kit.zip"`,
      ...NO_STORE,
      // Our own entry names only ([a-z0-9.-]), never a title, so the header is always valid.
      ...(skipped.length ? { 'x-brand-kit-skipped': skipped.map((s) => s.name).join(', ') } : {}),
    },
  })
}

const NO_STORE = { 'cache-control': 'no-store' }

function notFound() {
  return new NextResponse('Not found', { status: 404, headers: NO_STORE })
}

/**
 * Fetch one public object, reading at most `limit` bytes. A declared length over the limit
 * is refused before a byte is read; an undeclared one is read in chunks and dropped the
 * moment it passes the limit, so a huge object can never be buffered whole.
 */
async function fetchCapped(url: string, limit: number): Promise<{ bytes: Uint8Array } | { reason: string }> {
  const tooLarge = { reason: 'too large to fit in one download' }
  if (limit <= 0) return tooLarge
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok || !res.body) return { reason: 'missing from storage' }
    const declared = Number(res.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > limit) {
      await res.body.cancel()
      return tooLarge
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return tooLarge
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.byteLength
    }
    return { bytes }
  } catch {
    return { reason: 'could not be fetched' }
  }
}
