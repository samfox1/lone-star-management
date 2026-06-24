import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { type EntityType, listContent } from '@/lib/content'
import { ContentSection } from './content-sections'
import { SyncPanel } from './sync-panel'
import { ShopifyPanel } from './shopify-panel'
import { TEMPLATES } from '@/components/artist-template'
import {
  connectShopifyAction,
  disconnectShopifyAction,
  publishAction,
  saveBandsintownNameAction,
  saveSpotifyIdAction,
  saveTemplateAction,
  syncBandsintownAction,
  syncShopifyAction,
  syncSpotifyAction,
} from './actions'

const SECTIONS: EntityType[] = ['track', 'tour_date', 'merch', 'link']

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // RLS returns no row for a tenant the caller can't access, so .single() errors
  // → 404. A manager guessing another artist's id gets not-found, never a leak.
  const { data: artist, error } = await supabase
    .from('artists')
    .select('id, name, slug, spotify_artist_id, bandsintown_name, template')
    .eq('id', id)
    .single()
  if (error || !artist) notFound()

  // Load every content type's working rows in parallel.
  const rowsByType = Object.fromEntries(
    await Promise.all(
      SECTIONS.map(async (type) => [type, await listContent(supabase, type, id)] as const),
    ),
  )

  // Shopify connection state (the row holds only a pointer; the token lives in
  // Vault and is never read here).
  const { data: shopify } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('artist_id', id)
    .eq('provider', 'shopify')
    .maybeSingle()
  const shopifyDomain = (shopify?.metadata as { store_domain?: string } | null)?.store_domain ?? null

  const linkClass =
    'rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ← Your artists
          </Link>
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {artist.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <form action={saveTemplateAction.bind(null, artist.id)} className="flex items-center gap-1">
            <select
              name="template"
              defaultValue={artist.template}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" className={linkClass}>
              Apply
            </button>
          </form>
          <Link href={`/artists/${artist.id}/preview`} className={linkClass}>
            Preview
          </Link>
          <Link href={`/${artist.slug}`} className={linkClass}>
            View site
          </Link>
          <form action={publishAction.bind(null, artist.id)}>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Publish
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <SyncPanel
          title="Spotify"
          idName="spotify_artist_id"
          idValue={artist.spotify_artist_id ?? ''}
          placeholder="Spotify artist ID"
          hasId={!!artist.spotify_artist_id}
          pullLabel="Pull from Spotify"
          saveAction={saveSpotifyIdAction.bind(null, artist.id)}
          pullAction={syncSpotifyAction.bind(null, artist.id)}
        />
        <SyncPanel
          title="Bandsintown"
          idName="bandsintown_name"
          idValue={artist.bandsintown_name ?? ''}
          placeholder="Bandsintown artist name"
          hasId={!!artist.bandsintown_name}
          pullLabel="Pull tour dates"
          saveAction={saveBandsintownNameAction.bind(null, artist.id)}
          pullAction={syncBandsintownAction.bind(null, artist.id)}
        />
        <ShopifyPanel
          storeDomain={shopifyDomain}
          connectAction={connectShopifyAction.bind(null, artist.id)}
          pullAction={syncShopifyAction.bind(null, artist.id)}
          disconnectAction={disconnectShopifyAction.bind(null, artist.id)}
        />

        {SECTIONS.map((type) => (
          <ContentSection
            key={type}
            type={type}
            artistId={artist.id}
            rows={rowsByType[type]}
          />
        ))}
      </main>
    </div>
  )
}
