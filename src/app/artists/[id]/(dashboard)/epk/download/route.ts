import { NextResponse } from 'next/server'
import { DOCUMENTS_BUCKET, buildEpkPdf } from '@/lib/epk-pdf'
import { epkReadiness } from '@/lib/epk'
import { getPublishedSite } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'

/**
 * Generate the press kit and send it as a download.
 *
 * Built ON CLICK, fresh (Sam's decision 3): nothing is stored, so there is no stale file
 * and nothing for storage GC to chase — the cost is a second or so per download, on a
 * button pressed a handful of times.
 *
 * Everything is read through the PUBLISHED door, exactly as `/[slug]/epk` does, so the
 * attachment and the public link can never disagree (decision 2). The attachments are the
 * exception in one respect only: their OBJECTS live in the private `documents` bucket and
 * are fetched with the service role, because no browser session may read them — the
 * manager receives them merged into the PDF, never as a URL.
 *
 * The gate is re-checked here rather than trusted from the page. The button is disabled in
 * the UI, but a URL can be typed, and a half-empty press kit is exactly what the gate
 * exists to prevent.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()

  // RLS-scoped: a caller who cannot see this artist gets nothing, and the 404 does not
  // distinguish "no such artist" from "not yours".
  const { data: artistRow } = await supabase.from('artists').select('slug').eq('id', id).maybeSingle()
  if (!artistRow) return new NextResponse('Not found', { status: 404 })
  const slug = artistRow.slug as string

  const site = await getPublishedSite(supabase, slug)
  const { data: releaseRows } = await supabase.rpc('get_public_releases', { p_slug: slug })
  const releases = (releaseRows as { title: string; release_date: string | null }[] | null) ?? []

  const { ready, requirements } = epkReadiness({ site, releaseCount: releases.length })
  if (!ready || !site) {
    const missing = requirements.filter((r) => !r.met).map((r) => r.label)
    return NextResponse.json(
      { error: 'The press kit is not ready yet.', missing },
      { status: 409 },
    )
  }

  const [attachments, photo] = await Promise.all([loadAttachments(site), loadPhoto(site)])
  const { bytes, skipped } = await buildEpkPdf({
    site,
    releases,
    attachments,
    photo,
    collectSkipped: true,
  })

  const filename = `${slug}-press-kit.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      // Freshly built per request; caching it would defeat the point of not storing it.
      'cache-control': 'no-store',
      // Surfaced so the page can tell the manager an attachment was unreadable instead of
      // silently shipping a press kit that is quietly missing its rider.
      ...(skipped.length ? { 'x-epk-skipped': skipped.join(', ') } : {}),
    },
  })
}

/**
 * Fetch the stage plot and rider objects.
 *
 * SERVICE ROLE on purpose: `documents` is private with manager-only policies, and this
 * runs server-side on behalf of a caller already proven to manage the artist (the RLS-
 * scoped read above). The bytes go straight into the PDF and are never handed back as a
 * URL, so the bucket stays unreadable from a browser.
 *
 * Order is stage plot then rider — a promoter reads the plot first, and it is usually the
 * shorter document.
 */
async function loadAttachments(site: Awaited<ReturnType<typeof getPublishedSite>>) {
  if (!site) return []
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()

  const wanted: { label: string; path: string | null | undefined }[] = [
    { label: 'Stage plot', path: site.artist.stage_plot_path },
    { label: 'Tech rider', path: site.artist.tech_rider_path },
  ]

  const out = []
  for (const { label, path } of wanted) {
    if (!path) continue
    const { data } = await admin.storage.from(DOCUMENTS_BUCKET).download(path)
    // A missing object (deleted behind the row's back) is skipped like an unreadable one:
    // the press kit is still worth sending without it.
    if (data) out.push({ label, bytes: new Uint8Array(await data.arrayBuffer()) })
  }
  return out
}

/**
 * Fetch the header portrait: the published profile photo, falling back to the hero image —
 * the same order `/[slug]/epk` renders, so the PDF and the page show the same face.
 *
 * The `media` bucket is public, so this is an ordinary fetch, no service role needed.
 * Every failure is non-fatal and returns undefined: an unreachable object, a slow host, a
 * non-200. The gate guarantees a photo EXISTS; it cannot guarantee it is retrievable right
 * now, and a press kit without a portrait beats no press kit at all. A format pdf-lib
 * cannot embed (webp, gif — both of which the uploader accepts) is caught further in, by
 * `pdfImageFormat`, and reported as skipped.
 */
async function loadPhoto(site: Awaited<ReturnType<typeof getPublishedSite>>) {
  const url = site?.media.find((m) => m.purpose === 'profile_photo')?.url ?? site?.artist.hero_image_url
  if (!url) return undefined
  try {
    // Bounded: this runs inside a request the manager is waiting on, so a hung image host
    // must not hold the download open indefinitely.
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    if (!res.ok) return undefined
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return undefined
  }
}
