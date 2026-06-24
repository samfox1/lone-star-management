/**
 * Shopify integration panel. Unlike the read-only Spotify/Bandsintown panels,
 * connecting needs a store domain + a storefront token. The token is write-only
 * — it goes straight to Vault and is never read back to the page, so once
 * connected we show only the store domain.
 */
type BoundAction = (formData: FormData) => void | Promise<void>

export function ShopifyPanel({
  storeDomain,
  connectAction,
  pullAction,
  disconnectAction,
}: {
  storeDomain: string | null
  connectAction: BoundAction
  pullAction: BoundAction
  disconnectAction: BoundAction
}) {
  const inputClass =
    'rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Shopify
        </h2>
        {storeDomain && (
          <div className="flex items-center gap-2">
            <form action={pullAction}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Pull merch
              </button>
            </form>
            <form action={disconnectAction}>
              <button
                type="submit"
                className="rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Disconnect
              </button>
            </form>
          </div>
        )}
      </div>

      {storeDomain ? (
        <p className="mt-3 text-sm text-zinc-500">
          Connected to <span className="font-medium text-zinc-700 dark:text-zinc-300">{storeDomain}</span>
        </p>
      ) : (
        <form action={connectAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="store_domain" placeholder="store.myshopify.com" className={`flex-1 ${inputClass}`} />
          <input
            name="storefront_token"
            type="password"
            placeholder="Storefront access token"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Connect
          </button>
        </form>
      )}
      <p className="mt-2 text-xs text-zinc-400">
        Pulls products into draft merch. Your manual edits are never overwritten.
        The token is stored encrypted and never shown again.
      </p>
    </section>
  )
}
