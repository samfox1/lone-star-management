import { getShopifyDomain, requireArtist } from '../_data'

/**
 * Settings: integrations hub + (soon) SEO/OG and account. Config here applies
 * instantly — it is NOT part of the draft/publish flow. For now this summarizes
 * integration connection state; connect/pull still live on the section pages.
 */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const shopifyDomain = await getShopifyDomain(id)

  const integrations = [
    { name: 'Spotify', connected: !!artist?.spotify_artist_id, where: 'Tracks', detail: artist?.spotify_artist_id },
    { name: 'Bandsintown', connected: !!artist?.bandsintown_name, where: 'Tour dates', detail: artist?.bandsintown_name },
    { name: 'Shopify', connected: !!shopifyDomain, where: 'Merch', detail: shopifyDomain },
  ]

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Settings
      </h1>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">Integrations</h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {integrations.map((i) => (
            <li key={i.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{i.name}</span>
                <span className="ml-2 text-xs text-zinc-500">manage on {i.where}</span>
              </div>
              <span
                className={
                  i.connected
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-zinc-400 dark:text-zinc-500'
                }
              >
                {i.connected ? `Connected${i.detail ? ` · ${i.detail}` : ''}` : 'Not connected'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">SEO &amp; account</h2>
        <p className="mt-2 text-sm text-zinc-500">Coming soon.</p>
      </section>
    </div>
  )
}
