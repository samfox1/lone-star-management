'use client'

import { useState } from 'react'
import { BRAND_FOLDER } from '@/lib/brand'
import { cx } from '@/lib/cx'
import { acceptFor, IMAGE_UPLOAD_RULES } from '@/lib/upload'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { CardModal } from '../card-modal'
import { useConfirm } from '../confirm-dialog'
import { toast } from '../toast'
import { UploadField } from '../upload-field'
import { setBrandAssetAction } from './actions'

/**
 * A LOGO ROW (Sam, 2026-09-13): the mark on the checker, and beside it two tiny bare
 * glyphs stacked — replace, remove — faint until hovered, no chrome ("bare stacked").
 * Clicking the mark itself opens it LARGE in a modal, with Replace and Remove there too
 * ("clicking on the primary logo should allow the user to change it / get a bigger view").
 * With no logo yet, the row is a dashed square that IS the picker.
 *
 * The upload goes through UploadField in TRIGGER mode, so the compression gate is
 * composed in the one place it always is. Removing the PRIMARY logo also clears the tab
 * icon, which is derived from it. Both are asked about first — there is no undo.
 */
export function LogoRow({
  artistId,
  purpose,
  label,
  currentUrl,
  fullUrl,
}: {
  artistId: string
  purpose: 'logo_primary' | 'logo_secondary'
  label: string
  /** The thumbnail for the row. */
  currentUrl: string | null
  /** The full-size image for the modal; falls back to the thumbnail. */
  fullUrl?: string | null
}) {
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const lower = label.toLowerCase()

  async function remove(): Promise<{ error?: string } | void> {
    const res = await setBrandAssetAction(artistId, purpose, null)
    if (res.error) return res
    if (purpose === 'logo_primary') {
      const icon = await setBrandAssetAction(artistId, 'favicon', null)
      if (icon.error) return icon
    }
  }

  /** The row's own Remove asks itself; the modal's footer asks through CardModal. */
  async function removeFromRow() {
    if (!(await ask(`Remove the ${lower}?${purpose === 'logo_primary' ? ' The tab icon is made from it and goes too.' : ''}`, { action: 'Remove' }))) return
    const res = await remove()
    if (res?.error) return toast(res.error, 'error')
    toast(`${label} removed`)
  }

  return (
    <div className="flex items-center gap-2">
      {/* The explicit allowlist, never image/* — the picker must not advertise what the
          validator refuses (SVG is a script vector on a public bucket). */}
      <UploadField
        accept={acceptFor(IMAGE_UPLOAD_RULES)}
        label={`${label} file`}
        kind="image"
        budget={null}
        bucket="media"
        artistId={artistId}
        category={BRAND_FOLDER}
        noun="logo"
        rules={IMAGE_UPLOAD_RULES}
        successMessage={`${label} uploaded`}
        writeRow={async (path) => (await setBrandAssetAction(artistId, purpose, path)).error ?? null}
        onSuccess={() => setOpen(false)}
        trigger={(pick, { busy }) =>
          currentUrl ? (
            <>
              <button type="button" onClick={() => setOpen(true)} aria-label={`View ${lower}`} className="rounded-[10px] transition-opacity hover:opacity-80">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={currentUrl} alt={label} className={cx('h-14 w-[88px] rounded-[10px] object-contain p-1', CHECKER, busy && 'opacity-50')} />
              </button>
              <span className="flex flex-col gap-1.5">
                <button type="button" onClick={pick} disabled={busy} aria-label={`Replace ${lower}`} title="Replace" className={ACT}>
                  <Icon name="upload" size={12} />
                </button>
                <button type="button" onClick={removeFromRow} disabled={busy} aria-label={`Remove ${lower}`} title="Remove" className={cx(ACT, 'hover:text-accent-red')}>
                  <Icon name="trash" size={12} />
                </button>
              </span>

              {/* The bigger view: the mark large on the checker, Replace beside it, Remove in
                  the footer (which asks first, as every footer Delete does). */}
              <CardModal
                open={open}
                onClose={() => setOpen(false)}
                label={label}
                deleteAction={remove}
                deleteLabel="Remove"
                deleteNoun={label}
                confirmText={`Remove the ${lower}?${purpose === 'logo_primary' ? ' The tab icon is made from it and goes too.' : ''}`}
                footerLeft={
                  <button type="button" onClick={pick} disabled={busy} className={buttonClass('ghost')}>
                    <Icon name="upload" size={13} /> Replace
                  </button>
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fullUrl ?? currentUrl} alt={label} className={cx('mx-auto max-h-[360px] w-full rounded-2xl object-contain p-6', CHECKER, busy && 'opacity-50')} />
              </CardModal>
            </>
          ) : (
            <button
              type="button"
              onClick={pick}
              disabled={busy}
              aria-label={`Add ${lower}`}
              className="flex h-14 w-[88px] items-center justify-center rounded-[10px] border border-dashed border-hairline text-ink-faint transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
            >
              <Icon name="plus" size={14} />
            </button>
          )
        }
      />
      {dialog}
    </div>
  )
}

const CHECKER = 'bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:12px_12px]'
const ACT = 'flex h-4 w-4 items-center justify-center text-ink-faint transition-colors hover:text-ink disabled:opacity-40'
