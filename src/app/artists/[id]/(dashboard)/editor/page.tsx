import type { MediaKind } from '@samfox1/site-bridge/payload'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, listContent } from '@/lib/content'
import { groupTracksIntoProjects } from '@/lib/music'
import { isNewRelease } from '@samfox1/site-bridge/music'
import { fieldCurrentValue, manifestFor } from '@/lib/site-editor/manifest'
import { textPanelEntries } from '@/lib/site-editor/text-panel'
import { getWorkingSitePayload, mediaUrl, type SiteContent } from '@/lib/site'
import { isCustom } from '@/lib/custom-site'
import { requireArtist } from '../_data'
import { EditorShell } from './editor-shell'
import type {
  EditorImageField,
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
  // A custom-site artist's frame is their own external /edit route, which has no DB
  // access — so we fetch the draft here (RLS-scoped) and hand it over the bridge (wire
  // shape: media paths, not URLs — the custom site resolves them against its own
  // Supabase URL). A built-in template's frame reads its own draft server-side, so it
  // stays null and we don't pay for it.
  const customSiteUrl = isCustom(artist) ? (artist.custom_site_url as string) : null

  // ONE parallel wave: profile + site_content + media, every section's working rows,
  // and (custom sites only) the draft payload. All independent — so they run together
  // rather than in three serial waves of round-trips against the hosted DB.
  const [
    { data: profile },
    { data: contentRows },
    { data: mediaRows },
    linkRows,
    videoRows,
    merchRows,
    releaseRows,
    trackRows,
    tourRows,
    draft,
    { data: fontRows },
  ] = await Promise.all([
    supabase.from('artists').select('bio, hero_image_url').eq('id', id).single(),
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase
      .from('media')
      .select('id, purpose, storage_path, on_site, orientation, site_role, collection, label, alt, kind')
      .eq('artist_id', id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    listContent(supabase, 'link', id),
    listContent(supabase, 'video', id),
    listContent(supabase, 'merch', id),
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
    listContent(supabase, 'tour_date', id),
    customSiteUrl ? getWorkingSitePayload(supabase, id) : Promise.resolve(null),
    supabase.from('artist_fonts').select('family, label').eq('artist_id', id).order('family'),
  ])
  // Brand-page uploads, offered in every region's font dropdown alongside the site's own
  // manifest tokens. The token resolves because the published payload emits the matching
  // .font-<family> class.
  const uploadedFonts = (fontRows ?? []) as { family: string; label: string }[]

  const siteContent = Object.fromEntries(
    ((contentRows ?? []) as { key: string; value: string | null }[]).map((r) => [r.key, r.value ?? '']),
  ) as SiteContent

  const ctx = {
    template: artist.template,
    siteContent,
    artist: {
      name: artist.name,
      bio: (profile?.bio as string | null) ?? null,
      hero_image_url: (profile?.hero_image_url as string | null) ?? null,
    },
  }

  // Text fields resolved from the LOCAL manifest. These reach the panel only for a
  // BUILT-IN site: `artists.template` is CHECK-constrained to 'classic'/'cinematic', so a
  // custom artist (skeen: 'cinematic' + site_kind='custom') resolves a manifest too — one
  // describing a site nobody is looking at. The shell drops these for a custom site and
  // uses the frame's runtime manifest instead (see runtimeTextFields), which is why the
  // custom-ness test lives there rather than being repeated here.
  // Every text area the template declares: the copy a manager types AND the regions
  // that dress it. Built-ins declare no style regions today, so this is their fields.
  const textFields: EditorTextField[] = textPanelEntries(manifest?.fields, manifest?.styles).map((e) => ({
    key: e.key,
    label: e.label,
    type: (e.field?.type === 'email' ? 'email' : 'text') as 'text' | 'email',
    value: e.field ? fieldCurrentValue(e.field, ctx) : '',
    multiline: e.key === 'artist_bio' || e.key.endsWith('_copy'),
    styleRegion: e.styleRegion
      ? { key: e.styleRegion.key, label: e.styleRegion.label, base: e.styleRegion.base }
      : null,
    styleOnly: !e.field,
  }))

  // The site's single-occupancy image fields (hero image, profile photo) — declared by
  // the manifest, resolved to their current preview. hero_video is type:'image' too but
  // it's a VIDEO background (edited in the Videos panel), so it's excluded here. For a
  // custom site manifestFor is undefined, so these come from the frame's runtime manifest
  // instead (threaded through the shell); the built-in templates resolve here.
  const profilePhotoPath = (mediaRows ?? []).find((m) => m.purpose === 'profile_photo')?.storage_path as
    | string
    | undefined
  const imageFields: EditorImageField[] = (manifest?.fields ?? [])
    .filter(
      (f) =>
        (f.type === 'image' && f.target.store === 'artist' && f.target.column === 'hero_image_url') ||
        (f.type === 'image' && f.target.store === 'media' && f.target.purpose === 'profile_photo'),
    )
    .map((f) =>
      f.target.store === 'artist'
        ? { key: f.key, label: f.label, previewUrl: ctx.artist.hero_image_url, target: { store: 'artist', column: 'hero_image_url' } }
        : { key: f.key, label: f.label, previewUrl: profilePhotoPath ? mediaUrl(profilePhotoPath) : null, target: { store: 'media', purpose: 'profile_photo' } },
    )

  const photos = (mediaRows ?? [])
    .filter((m) => m.purpose === 'gallery_image')
    .map((m) => ({
      id: m.id as string,
      storage_path: m.storage_path as string,
      onSite: (m.on_site as boolean | null) ?? false,
      orientation: (m.orientation as 'horizontal' | 'vertical' | null) ?? null,
      siteRole: (m.site_role as string | null) ?? null,
      collection: (m.collection as string | null) ?? null,
      label: (m.label as string | null) ?? null,
      alt: (m.alt as string | null) ?? null,
      kind: (m.kind as MediaKind | null) ?? null,
    }))


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
    ticketUrl: (r.ticket_url as string | null) ?? null,
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
    inStock: (r.in_stock as boolean | null) ?? true,
  }))

  // The Music panel lists PROJECTS, not songs, newest-first: songs grouped by their PARENT
  // release (groupTracksIntoProjects), a parent-less song standing alone. `on_site` on the
  // songs is the only visibility gate; a project's cover is its first song's art.
  // ONE "today" for the whole page — the same seam the site threads into its own badge,
  // so the panel and the grid can never disagree about which covers are new.
  const today = new Date().toISOString().slice(0, 10)
  const releaseById = new Map(releaseRows.map((r) => [r.id as string, r]))
  const trackById = new Map(trackRows.map((t) => [t.id as string, t]))
  const releases: EditorProject[] = groupTracksIntoProjects(
    trackRows.map((t) => ({
      id: t.id as string,
      release_id: (t.release_id as string | null) ?? null,
      release_type: (t.release_type as string | null) ?? null,
      title: (t.title as string | null) ?? null,
      on_site: (t.on_site as boolean | null) ?? false,
      sort_order: (t.sort_order as number | null) ?? null,
      release_date: (t.release_date as string | null) ?? null,
    })),
    (rid) => {
      const r = releaseById.get(rid)
      return r ? { title: (r.title as string | null) ?? null, release_date: (r.release_date as string | null) ?? null } : undefined
    },
  ).map((p) => ({
    key: p.key,
    title: p.title,
    cover_url: (trackById.get(p.trackIds[0])?.cover_url as string | null) ?? null,
    kind: p.releaseType,
    songs: p.trackIds.map((id) => ({ id, title: (trackById.get(id)?.title as string | null) ?? 'Untitled' })),
    onSite: p.anyOnSite,
    // Out in the last week. `today` is stamped once for the whole render (below) rather
    // than per project, so every card on one screen is judged against the same day.
    isNew: isNewRelease(p.releaseDate, today),
  }))

  // Draft ≠ published? Computed server-side so Revert changes survives a refresh
  // (Sam, 2026-08-17: the divider stayed off after a reload while the button vanished).
  // router.refresh() after a revert or publish re-runs this and the flag follows.
  const unpublished = await diffUnpublished(supabase, id).catch(() => null)
  const hasUnpublished = unpublished
    ? Object.values(unpublished).some((d) => d.dirty)
    : false

  return (
    <EditorShell
      artistId={id}
      customSiteUrl={customSiteUrl}
      hasUnpublished={hasUnpublished}
      draft={draft}
      photos={photos}
      imageFields={imageFields}
      textFields={textFields}
      siteContent={siteContent}
      links={links}
      supportLinks={supportLinks}
      linkValues={linkValues}
      videos={videos}
      merch={merch}
      releases={releases}
      tours={tours}
      uploadedFonts={uploadedFonts}
    />
  )
}
