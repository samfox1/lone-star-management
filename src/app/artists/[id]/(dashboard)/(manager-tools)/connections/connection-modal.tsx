'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { SHOPIFY_KEY, idFromProfileUrl, methodOf, profileLink, type ConnectionRow } from '@/lib/connections'
import { handleFromUrl, parseHandle } from '@/lib/connect-methods'
import { saveSourceIdAction, updateContentAction } from '../../actions'
import { CardModal } from '../../card-modal'
import { KvField, KvRow, ModalHeader } from '../../modal-kit'
import { toast } from '../../toast'
import { ConnectionMark } from './connection-mark'
import { EVENTBRITE_KEY, eventbriteStartPath } from '@/lib/manager-tools/connections/services/eventbrite'
import { EventbriteTrip, ShopifyLink } from './connect-modal'
import { connectOneAction, disconnectConnectionAction, getShopifyDomainAction, pullConnectionAction, syncProfileAction, type ConnectResult } from './actions'

const FIELD_CLASS =
  'block h-6 min-w-0 w-full border-b border-hairline bg-transparent p-0 font-space text-[13px] leading-6 text-ink outline-none placeholder:text-hairline focus:border-ink'

/**
 * ONE CONNECTION, opened by clicking its row (Sam, 2026-09-13: "remove the 2 dots… You
 * click on the row and then you can edit it"). The modal kit's grammar: the mark stands
 * where cover art would, the name is the title, the state is the meta. Every row saves
 * its own field; the footer's Remove takes the link off the site AND stops pulling from
 * the source, after asking.
 */
export function ConnectionModal({
  artistId,
  row,
  open,
  onClose,
  onChange,
  shopifyApp = false,
  eventbriteApp = false,
}: {
  artistId: string
  row: ConnectionRow
  open: boolean
  onClose: () => void
  /** The row as it now is, or null once removed. */
  onChange: (next: ConnectionRow | null) => void
  /** The Shopify app is set up (a server-made boolean): the Store row changes the store by
   *  going to Shopify, and there is no token to type. */
  shopifyApp?: boolean
  /** The Eventbrite app is set up (a server-made boolean): its row can sign in from here —
   *  to connect a pasted link's shows, or to renew or change the sign-in. */
  eventbriteApp?: boolean
}) {
  const router = useRouter()
  const [pulling, setPulling] = useState(false)
  const pullingRef = useRef(false)
  const [result, setResult] = useState<ConnectResult | null>(null)
  const fail = (message: string) => toast(message, 'error')

  // SHOPIFY: change the store domain and/or rotate the storefront token without
  // disconnecting first (docs review, 2026-09-28). The domain is read the same way the
  // page already can (`getShopifyDomainAction` → `getShopifyDomain`); the token is NEVER
  // read back — it lives in Vault — so the field always starts empty.
  const isShopify = row.def.key === SHOPIFY_KEY
  const [domain, setDomain] = useState('')
  const [token, setToken] = useState('')
  const [savingStore, setSavingStore] = useState(false)
  const savingStoreRef = useRef(false)
  const [storeResult, setStoreResult] = useState<ConnectResult | null>(null)
  /** App mode: why the typed store address can't be used, until it changes. */
  const [shopError, setShopError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !isShopify) return
    let cancelled = false
    void getShopifyDomainAction(artistId)
      .then((d) => {
        if (!cancelled) setDomain(d ?? '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, isShopify, artistId, row.key])

  /** Runs the SAME connect path as a first connect (`connectOneAction` →
   *  `connectShopifyAction` + the probe), so a bad token is refused with the probe's
   *  plain-words advice and the old connection stays intact — `connect_shopify` upserts
   *  the Vault secret rather than failing or wiping it. */
  async function saveStore() {
    if (savingStoreRef.current) return
    savingStoreRef.current = true
    setSavingStore(true)
    setStoreResult(null)
    try {
      const res = await connectOneAction(artistId, row.key, { domain, token })
      setStoreResult(res)
      if (res.ok) {
        setToken('')
        router.refresh()
      }
    } finally {
      savingStoreRef.current = false
      setSavingStore(false)
    }
  }

  async function saveUrl(url: string) {
    if (!row.linkId) return
    const fd = new FormData()
    fd.set('url', url)
    const res = await updateContentAction('link', row.linkId, artistId, fd)
    if (!res?.error) onChange({ ...row, url })
    return res
  }

  // A handle platform shows the HANDLE (Sam, 2026-09-28), and saves the link it builds; a
  // stored link that is not a plain profile (a YouTube channel id) is shown as the link.
  const found = methodOf(row.def)
  const method = found?.kind === 'handle' ? found : null
  const handle = method && row.url ? handleFromUrl(method, row.url) : null
  const handleLabel = method ? method.noun[0].toUpperCase() + method.noun.slice(1) : ''

  // A link platform's link (Spotify, WhatsApp…) is checked the way Connect checks it, and
  // saved the way that rule saves it; the server refuses the same (updateContentAction).
  async function saveLink(raw: string) {
    const link = found?.kind === 'link' ? profileLink(row.def, { url: raw }) : { url: raw }
    if ('error' in link) return { error: link.error }
    if (link.url === row.url) return
    return saveUrl(link.url)
  }

  async function saveHandle(raw: string) {
    if (!method) return
    const parsed = parseHandle(method, raw)
    if ('error' in parsed) return { error: parsed.error }
    if (parsed.url === row.url) return
    return saveUrl(parsed.url)
  }

  async function saveId(id: string) {
    if (!row.def.source?.idField) return
    const res = await saveSourceIdAction(artistId, row.def.source.idField, id)
    if (!res?.error) onChange({ ...row, sourceId: id })
    return res
  }

  /** First pull for a never-synced profile (the id comes out of the link), or a fresh
   *  pull for one that has. Either way the page re-reads the truth afterwards. */
  async function pull() {
    if (pullingRef.current) return
    pullingRef.current = true
    setPulling(true)
    setResult(null)
    try {
      const res = row.state === 'connect' ? await syncProfileAction(artistId, row.key) : await pullConnectionAction(artistId, row.key)
      setResult(res)
      if (res.ok) router.refresh()
    } finally {
      pullingRef.current = false
      setPulling(false)
    }
  }

  const meta =
    row.state === 'synced' ? 'synced' : row.state === 'failed' ? 'couldn’t connect' : row.state === 'connect' ? 'not synced' : null

  return (
    <CardModal
      open={open}
      onClose={onClose}
      label={row.label}
      deleteAction={async () => {
        const res = await disconnectConnectionAction(artistId, row.key, row.linkId)
        if (!res?.error) onChange(null)
        return res
      }}
      deleteLabel="Remove"
      deleteNoun="Connection"
      confirmText={`Remove ${row.label}? Its link comes off the site and nothing more is pulled from it.`}
    >
      <ModalHeader
        square={
          <div className="flex h-14 w-14 flex-none items-center justify-center rounded-xl border border-hairline text-ink">
            <ConnectionMark def={row.def} size={26} />
          </div>
        }
        title={row.label}
        meta={meta ? <span className={cx(row.state === 'failed' && 'text-accent-red')}>{meta}</span> : undefined}
      />
      <div className="mt-5">
        {row.linkId && (
          <KvField
            {...(method && handle !== null
              ? { label: handleLabel, value: handle, onSave: saveHandle }
              : { label: 'Link', value: row.url ?? '', type: 'url' as const, onSave: saveLink })}
            mono
            onError={fail}
            trailing={
              row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open"
                  title="Open"
                  className="flex-none text-ink-faint transition-colors hover:text-ink"
                >
                  <Icon name="external" size={14} />
                </a>
              ) : null
            }
          />
        )}
        {row.def.source?.idField && row.sourceId !== undefined && (
          <KvField label="ID" value={row.sourceId ?? ''} mono onSave={saveId} onError={fail} />
        )}
        {/* With the app set up, the store is changed (or its token renewed) by going to
            Shopify again — the callback saves through the same connect path. */}
        {isShopify && shopifyApp && (
          <KvRow label="Store" align="start">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                aria-label="Store domain"
                placeholder="store.myshopify.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value)
                  setShopError(null)
                }}
                className={cx(FIELD_CLASS, 'font-space', shopError && 'border-accent-red focus:border-accent-red')}
              />
              <div className="flex items-center gap-3">
                <ShopifyLink artistId={artistId} domain={domain} onBad={setShopError} className={buttonClass('ghost', 'whitespace-nowrap')} />
              </div>
              {shopError && (
                <span role="alert" className="font-space text-[11px] text-accent-red">
                  {shopError}
                </span>
              )}
            </div>
          </KvRow>
        )}
        {isShopify && !shopifyApp && (
          <KvRow label="Store" align="start">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                aria-label="Store domain"
                placeholder="store.myshopify.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className={cx(FIELD_CLASS, 'font-space')}
              />
              <input
                aria-label="New storefront token"
                type="password"
                placeholder="Storefront access token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={cx(FIELD_CLASS, 'font-space')}
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={saveStore} disabled={savingStore} className={buttonClass('ghost', 'disabled:opacity-50')}>
                  <Icon name="refresh" size={13} className={cx(savingStore && 'animate-spin')} />
                  {savingStore ? 'Saving…' : 'Change token'}
                </button>
                {storeResult && (
                  <span className={cx('min-w-0 truncate font-space text-[11px]', storeResult.ok ? 'text-ink-muted' : 'text-accent-red')}>
                    {storeResult.ok ? storeResult.message ?? 'Saved' : `${storeResult.error}${storeResult.detail ? ` ${storeResult.detail}` : ''}`}
                  </span>
                )}
              </div>
            </div>
          </KvRow>
        )}
        {/* A pasted Eventbrite link is dimmed in the Connect grid, so its sign-in lives here:
            the linked organizer page rides along as the one to connect. */}
        {eventbriteApp && row.def.key === EVENTBRITE_KEY && (
          <KvRow label="Sign-in" align="start">
            <EventbriteTrip href={eventbriteStartPath(artistId, row.url ? idFromProfileUrl(row.def, row.url) : null)} />
          </KvRow>
        )}
        {/* 'none' with a source: a sign-in source whose app is not set up here — nothing can pull. */}
        {row.def.source && row.state !== 'none' && (
          <KvRow label="Catalog">
            <button type="button" onClick={pull} disabled={pulling} className={buttonClass('ghost', 'disabled:opacity-50')}>
              <Icon name="refresh" size={13} className={cx(pulling && 'animate-spin')} />
              {pulling ? 'Pulling…' : row.state === 'connect' ? 'Sync' : 'Pull now'}
            </button>
            {result && (
              <span className={cx('min-w-0 truncate font-space text-[11px]', result.ok ? 'text-ink-muted' : 'text-accent-red')}>
                {result.ok ? result.message ?? 'Pulled' : result.error}
              </span>
            )}
          </KvRow>
        )}
      </div>
    </CardModal>
  )
}
