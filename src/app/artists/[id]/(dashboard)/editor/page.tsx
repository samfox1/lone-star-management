import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { groupTracksIntoProjects } from '@/lib/music'
import { fieldCurrentValue, manifestFor } from '@/lib/site-editor/manifest'
import { getWorkingSitePayload, type SiteContent } from '@/lib/site'
import { isCustom } from '@/lib/custom-site'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'
import type {
  EditorLink,
  EditorMerch,
  EditorProject,
  EditorSupportLink,
  EditorTextField,
  EditorTour,
  EditorVideo,
} from './editor-inspector'

/** YouTube poster thumbnail from an embed URL (mirrors the Videos page helper). */
function youtubePoster(url: string, provider: string): string | null {
  if (provider !== 'youtube') return null
  const m = url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * Visual editor page — a dashboard section (centered "Edit site" nav tab). Renders
 * the editor shell (left inspector + the site frame) below the top nav.
 * `requireArtist` is the non-owner → 404 gate. The inspector reads the artist's real
 * data: `gallery_image` media (Images) and the manifest's text fields with their
 * current draft values (Text). Remaining component types + saves land next.
 */
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const manifest = manifestFor(artist.template) ?? null

  const supabase = await createClient()
  const [{ data: profile }, { data: contentRows }, { data: mediaRows }] = await Promise.all([
    supabase.from('artists').select('bio, hero_image_url').eq('id', id).single(),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase
      .from('media')
      .select('id, purpose, storage_path, on_site, orientation, site_role')
      .eq('artist_id', id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const siteContent = Object.fromEntries(
    ((contentRows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']),
  ) as SiteContent

  // A custom-site artist's frame is their own external /edit route, which has no
  // DB access — so fetch the draft here (RLS-scoped) and let the shell hand it
  // over the bridge. A built-in template's frame reads its own draft server-side,
  // so we don't pay for this. Wire shape (media paths, not URLs): the custom site
  // resolves them against ITS OWN Supabase URL.
  const customSiteUrl = isCustom(artist) ? (artist.custom_site_url as string) : null
  const draft = customSiteUrl ? await getWorkingSitePayload(supabase, id) : null

  const ctx = {
    template: artist.template,
    siteContent,
    artist: {
      name: artist.name,
      bio: (profile?.bio as string | null) ?? null,
      hero_image_url: (profile?.hero_image_url as string | null) ?? null,
    },
  }

  const textFields: EditorTextField[] = manifest
    ? manifest.fields
        .filter((f) => f.type === 'text' || f.type === 'email')
        .map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type as 'text' | 'email',
          value: fieldCurrentValue(f, ctx),
          multiline: f.key === 'artist_bio' || f.key.endsWith('_copy'),
        }))
    : []

  const photos = (mediaRows ?? [])
    .filter((m) => m.purpose === 'gallery_image')
    .map((m) => ({
      id: m.id as string,
      storage_path: m.storage_path as string,
      onSite: (m.on_site as boolean | null) ?? false,
      orientation: (m.orientation as 'horizontal' | 'vertical' | null) ?? null,
      siteRole: (m.site_role as string | null) ?? null,
    }))


  const [linkRows, videoRows, merchRows, releaseRows, trackRows, tourRows] = await Promise.all([
    listContent(supabase, 'link', id),
    listContent(supabase, 'video', id),
    listContent(supabase, 'merch', id),
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
    listContent(supabase, 'tour_date', id),
  ])
  // Socials = ordinary outbound links. A link bound to a manifest region (role set) is
  // NOT a social — it powers a declared button (USB/Merch) and lives in the Site-links
  // panel instead, so it's excluded here. (`role` only exists after 20260721... is
  // applied; until then every row reads role=undefined and stays in Socials.)
  const links: EditorLink[] = linkRows
    .filter((r) => !r.role)
    .map((r) => ({
      id: r.id,
      label: (r.label as string | null) ?? '',
      url: (r.url as string | null) ?? '',
      // Links default on_site=true (20260708150000), so an existing link stays on the
      // site until the manager deliberately takes it off — unlike a photo, which is
      // off until selected.
      onSite: (r.on_site as boolean | null) ?? true,
    }))
  // Current URL for each manifest link region, keyed by its role. The regions
  // themselves arrive from the frame's manifest at runtime (custom site).
  const linkValues: Record<string, string> = Object.fromEntries(
    linkRows.filter((r) => r.role).map((r) => [String(r.role), (r.url as string | null) ?? '']),
  )
  const videosBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const videos: EditorVideo[] = videoRows.map((r) => {
    const provider = String(r.provider ?? '')
    const storagePath = (r.storage_path as string | null) ?? null
    return {
      id: r.id,
      title: (r.title as string | null) ?? '',
      provider,
      // The YouTube band is EMBEDS only; Shorts aren't used on sites. The picker filters
      // on these so only real YouTube videos are placeable.
      isShort: (r.is_short as boolean | null) ?? false,
      // A background slot the video is placed in (hero landscape/portrait), or null.
      siteRole: (r.site_role as 'hero_landscape' | 'hero_portrait' | 'bio_background' | null) ?? null,
      poster: youtubePoster(String(r.embed_url ?? ''), provider),
      // Uploaded videos preview as a first-frame thumbnail (#t=0.1 seeks past frame 0,
      // which some browsers render black). The videos bucket is public.
      previewUrl: storagePath ? `${videosBase}/storage/v1/object/public/videos/${storagePath}#t=0.1` : null,
      // The YouTube sync imports videos OFF-site (`insertDefaults: on_site:false`),
      // so a synced channel lands in the library and waits to be chosen. The panel
      // has to show that, or it reads as "all 83 are on your site".
      onSite: (r.on_site as boolean | null) ?? false,
    }
  })
  // Every date in the library, past ones included — the site splits upcoming from past
  // itself, so hiding past dates here would make them unreachable. Ordered by date
  // (PUBLISHABLE.tour_date.orderBy), the same order the public door serves.
  const tours: EditorTour[] = tourRows.map((r) => ({
    id: r.id,
    date: (r.date as string | null) ?? null,
    venue: (r.venue as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    support: (r.support as string[] | null) ?? [],
    // New/synced dates land off-site (INSERT_OFF_SITE) and are chosen here.
    onSite: (r.on_site as boolean | null) ?? false,
  }))

  // Flatten every date's support acts into per-act rows for the Links panel's "Tour
  // support" group: the act NAME + its current URL (from the date's support_urls map) +
  // a short label for WHICH show it's on. The name is edited on the Tour page; only the
  // URL is set here (setSupportUrlAction → tour_dates.support_urls).
  const supportLinks: EditorSupportLink[] = tourRows.flatMap((r) => {
    const names = (r.support as string[] | null) ?? []
    const urls = (r.support_urls as Record<string, string> | null) ?? {}
    const show =
      (r.venue as string | null) ||
      (r.city as string | null) ||
      (r.date as string | null) ||
      'Untitled show'
    return names.map((name) => ({ tourDateId: r.id, name, url: urls[name] ?? '', show }))
  })
  const merch: EditorMerch[] = merchRows.map((r) => ({
    id: r.id,
    title: (r.title as string | null) ?? '',
    price: r.price == null ? '' : String(r.price),
    url: (r.url as string | null) ?? '',
    image_url: (r.image_url as string | null) ?? null,
    // Like videos: a new/imported product lands off-site (INSERT_OFF_SITE) and is
    // chosen + published on the Merch page.
    onSite: (r.on_site as boolean | null) ?? false,
  }))

  // The Music panel lists PROJECTS, not songs, newest-first: songs grouped by ALBUM NAME
  // (groupTracksIntoProjects), an album-less song standing alone. The release row sharing
  // the album name supplies each project's type + date. `on_site` on the songs is the
  // only visibility gate; a project's cover is its first song's art, purely for display.
  const releaseByAlbum = new Map(
    releaseRows.filter((r) => r.title).map((r) => [String(r.title), r]),
  )
  const trackById = new Map(trackRows.map((t) => [t.id as string, t]))
  const releases: EditorProject[] = groupTracksIntoProjects(
    trackRows.map((t) => ({
      id: t.id as string,
      album_name: (t.album_name as string | null) ?? null,
      release_type: (t.release_type as string | null) ?? null,
      on_site: (t.on_site as boolean | null) ?? false,
    })),
    (name) => {
      const r = releaseByAlbum.get(name)
      return r ? { title: (r.title as string | null) ?? null, release_date: (r.release_date as string | null) ?? null } : undefined
    },
  ).map((p) => ({
    key: p.key,
    title: p.title,
    cover_url: (trackById.get(p.trackIds[0])?.cover_url as string | null) ?? null,
    kind: p.releaseType,
    songs: p.trackIds.map((id) => ({ id, title: (trackById.get(id)?.title as string | null) ?? 'Untitled' })),
    onSite: p.anyOnSite,
  }))

  return (
    <EditorShell
      artistId={id}
      customSiteUrl={customSiteUrl}
      draft={draft}
      photos={photos}
      textFields={textFields}
      links={links}
      supportLinks={supportLinks}
      linkValues={linkValues}
      videos={videos}
      merch={merch}
      releases={releases}
      tours={tours}
      componentLabels={siteContent}
    />
  )
}
