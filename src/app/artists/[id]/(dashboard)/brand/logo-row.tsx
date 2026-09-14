'use client'

import { useRef } from 'react'
import { BRAND_FOLDER } from '@/lib/brand'
import { cx } from '@/lib/cx'
import { acceptFor, IMAGE_UPLOAD_RULES } from '@/lib/upload'
import { Icon } from '@/components/ui/icons'
import { useBudgetGate } from '../budget-gate'
import { useConfirm } from '../confirm-dialog'
import { toast } from '../toast'
import { useStorageUpload } from '../use-storage-upload'
import { setBrandAssetAction } from './actions'

/**
 * A LOGO ROW (Sam, 2026-09-13): the mark on the checker, and beside it two tiny bare
 * glyphs stacked — replace, remove — faint until hovered, no chrome ("bare stacked").
 * With no logo yet, the row is a dashed square that IS the picker. No caption: the label
 * on the left says which logo this is, and the checker says what a transparent PNG is for.
 *
 * Removing the PRIMARY logo also clears the tab icon, which is derived from it. Both are
 * asked about first — there is no undo.
 */
export function LogoRow({
  artistId,
  purpose,
  label,
  currentUrl,
}: {
  artistId: string
  purpose: 'logo_primary' | 'logo_secondary'
  label: string
  currentUrl: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { ask, dialog } = useConfirm()
  const { busy, upload } = useStorageUpload({
    bucket: 'media',
    artistId,
    category: BRAND_FOLDER,
    noun: 'logo',
    rules: IMAGE_UPLOAD_RULES,
    successMessage: `${label} uploaded`,
    writeRow: async (path) => (await setBrandAssetAction(artistId, purpose, path)).error ?? null,
  })
  const gate = useBudgetGate('image', null)

  async function pick(file: File | undefined) {
    if (!file) return
    const prepared = await gate.prepare(file)
    if (prepared) await upload(prepared)
  }

  async function remove() {
    if (!(await ask(`Remove the ${label.toLowerCase()}?${purpose === 'logo_primary' ? ' The tab icon is made from it and goes too.' : ''}`, { action: 'Remove' }))) return
    const res = await setBrandAssetAction(artistId, purpose, null)
    if (res.error) return toast(res.error, 'error')
    if (purpose === 'logo_primary') {
      const icon = await setBrandAssetAction(artistId, 'favicon', null)
      if (icon.error) return toast(icon.error, 'error')
    }
    toast(`${label} removed`)
  }

  return (
    <div className="flex items-center gap-2">
      {/* The explicit allowlist, never image/* — the picker must not advertise what the
          validator refuses (SVG is a script vector on a public bucket). */}
      <input
        ref={inputRef}
        type="file"
        accept={acceptFor(IMAGE_UPLOAD_RULES)}
        aria-label={`${label} file`}
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {currentUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt={label}
            className={cx('h-14 w-[88px] rounded-[10px] bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:12px_12px] object-contain p-1', busy && 'opacity-50')}
          />
          <span className="flex flex-col gap-1.5">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} aria-label={`Replace ${label.toLowerCase()}`} title="Replace" className={ACT}>
              <Icon name="upload" size={12} />
            </button>
            <button type="button" onClick={remove} disabled={busy} aria-label={`Remove ${label.toLowerCase()}`} title="Remove" className={cx(ACT, 'hover:text-accent-red')}>
              <Icon name="trash" size={12} />
            </button>
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={`Add ${label.toLowerCase()}`}
          className="flex h-14 w-[88px] items-center justify-center rounded-[10px] border border-dashed border-hairline text-ink-faint transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
        >
          <Icon name="plus" size={14} />
        </button>
      )}
      {gate.modal}
      {dialog}
    </div>
  )
}

const ACT = 'flex h-4 w-4 items-center justify-center text-ink-faint transition-colors hover:text-ink disabled:opacity-40'
