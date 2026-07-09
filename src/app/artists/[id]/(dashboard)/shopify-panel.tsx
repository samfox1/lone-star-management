/**
 * Shopify integration panel. Unlike the id-based catalog panels, connecting needs
 * a store domain + a storefront token. The token is write-only — it goes straight
 * to Vault and is never read back to the page, so once connected we show only the
 * store domain. Connect / pull / disconnect each confirm with a toast.
 */
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SaveForm } from './save-form'
import { ActionButton } from './action-button'

type ConnectAction = (formData: FormData) => Promise<{ error?: string }>
type PullAction = () => Promise<{ ok: boolean; error?: string }>
type DisconnectAction = () => Promise<{ error?: string }>

export function ShopifyPanel({
  storeDomain,
  connectAction,
  pullAction,
  disconnectAction,
}: {
  storeDomain: string | null
  connectAction: ConnectAction
  pullAction: PullAction
  disconnectAction: DisconnectAction
}) {
  return (
    <section className="mb-4 rounded-xl border border-hairline bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Shopify</h2>
        {storeDomain && (
          <div className="flex items-center gap-2">
            <ActionButton
              action={pullAction}
              savedMessage="Merch pulled"
              busyLabel="Pulling…"
              className={buttonClass('ghost')}
            >
              Pull merch
            </ActionButton>
            <ActionButton
              action={disconnectAction}
              savedMessage="Shopify disconnected"
              confirm="Disconnect this Shopify store? Your synced merch stays, but you'll need to reconnect to pull again."
              className="rounded-md px-2 py-1.5 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
            >
              Disconnect
            </ActionButton>
          </div>
        )}
      </div>

      {storeDomain ? (
        <p className="mt-3 font-space text-sm text-ink-muted">
          Connected to <span className="font-bold text-ink">{storeDomain}</span>
        </p>
      ) : (
        <SaveForm
          action={connectAction}
          savedMessage="Shopify connected"
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input name="store_domain" placeholder="store.myshopify.com" className={`flex-1 ${inputClass}`} />
          <input
            name="storefront_token"
            type="password"
            placeholder="Storefront access token"
            className={`flex-1 ${inputClass}`}
          />
          <button type="submit" className={buttonClass('solid')}>
            Connect
          </button>
        </SaveForm>
      )}
      <p className="mt-2 font-space text-xs text-ink-faint">
        Pulls products into draft merch. Your manual edits are never overwritten. The token
        is stored encrypted and never shown again.
      </p>
    </section>
  )
}
