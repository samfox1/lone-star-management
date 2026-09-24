'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import type { ConnectionRow } from '@/lib/connections'
import { saveSourceIdAction, updateContentAction } from '../../actions'
import { CardModal } from '../../card-modal'
import { KvField, KvRow, ModalHeader } from '../../modal-kit'
import { toast } from '../../toast'
import { ConnectionMark } from './connection-mark'
import { disconnectConnectionAction, pullConnectionAction, syncProfileAction, type ConnectResult } from './actions'

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
}: {
  artistId: string
  row: ConnectionRow
  open: boolean
  onClose: () => void
  /** The row as it now is, or null once removed. */
  onChange: (next: ConnectionRow | null) => void
}) {
  const router = useRouter()
  const [pulling, setPulling] = useState(false)
  const pullingRef = useRef(false)
  const [result, setResult] = useState<ConnectResult | null>(null)
  const fail = (message: string) => toast(message, 'error')

  async function saveUrl(url: string) {
    if (!row.linkId) return
    const fd = new FormData()
    fd.set('url', url)
    const res = await updateContentAction('link', row.linkId, artistId, fd)
    if (!res?.error) onChange({ ...row, url })
    return res
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
            label="Link"
            value={row.url ?? ''}
            type="url"
            mono
            onSave={saveUrl}
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
        {row.def.source && (
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
