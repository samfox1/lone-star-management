'use client'

import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { DOCUMENTS_BUCKET, DOCUMENTS_FOLDER, type PressDocumentKind } from '@/lib/epk'
import { DOCUMENT_UPLOAD_RULES } from '@/lib/upload'
import { UploadField } from '../../upload-field'
import { toast } from '../../toast'
import { LedgerRow } from '../_ui/ledger'
import { HoverLabel, RowIcon } from '../_ui/row-icon'
import { FOCUS_RING_OFFSET } from '../_ui/styles'
import { savePressDocumentAction } from './actions'

/** The tile's box: a logo tile's size (brand/logos/logo-tile.tsx), 112×64. */
const TILE = 'relative grid h-16 w-28 flex-none place-items-center rounded-lg border border-hairline'

/**
 * One press-document row, the stage plot or the tech rider, in Brand's ledger (Batch 3, Sam
 * 2026-10-02): the name, what it is, "PDF · private", and a tile on the right. Empty, the tile is
 * a dashed "Add" beside a + ; attached, it shows a PDF mark, clicking it uploads a new one, and
 * the row ends in a trash.
 *
 * Uploads go to the PRIVATE `documents` bucket, so unlike every other uploader on the dashboard
 * there is no preview and no link: the file is not reachable from a browser by design. It
 * reaches a promoter only by being merged into the generated press kit, once published (the
 * path rides the profile snapshot, so the page's Publish bar lights after an upload or a remove).
 * UploadField's trigger mode keeps its compression gate and byte cap (DOCUMENT_UPLOAD_RULES).
 */
export function DocumentUpload({
  artistId,
  kind,
  label,
  hint,
  present,
}: {
  artistId: string
  kind: PressDocumentKind
  label: string
  hint: string
  present: boolean
}) {
  const noun = label.toLowerCase()

  async function clear() {
    const res = await savePressDocumentAction(artistId, kind, null)
    // Surfaced, not swallowed: a Remove blocked by RLS must not look like it worked.
    if (res.error) toast(res.error, 'error')
  }

  return (
    <LedgerRow
      title={label}
      guide={hint}
      meta="PDF · private"
      remove={present ? <RowIcon icon="trash" label="Remove" tone="danger" onClick={() => void clear()} /> : undefined}
    >
      <UploadField
        accept="application/pdf"
        label={present ? `Replace ${noun}` : `Upload ${noun}`}
        bucket={DOCUMENTS_BUCKET}
        artistId={artistId}
        category={DOCUMENTS_FOLDER}
        noun="document"
        rules={DOCUMENT_UPLOAD_RULES}
        successMessage={`${label} uploaded`}
        writeRow={async (path) => (await savePressDocumentAction(artistId, kind, path)).error ?? null}
        trigger={(open, { busy }) =>
          present ? (
            // Attached: the tile IS the replace control, so it is a real, named button.
            <button
              type="button"
              onClick={open}
              disabled={busy}
              aria-label={`Replace ${noun}`}
              data-document-tile="file"
              className={cx(TILE, 'cursor-pointer bg-surface text-ink disabled:cursor-wait', FOCUS_RING_OFFSET)}
            >
              <span className="flex flex-col items-center gap-[3px] font-space text-[10px] tracking-[0.06em] text-ink-muted">
                {busy ? '…' : <Icon name="note" size={20} />}
                PDF
              </span>
              <HoverLabel label="Upload new" />
            </button>
          ) : (
            <>
              {/* Empty: a mouse shortcut only. The + beside it is the keyboard's and the screen
                  reader's way in, so the tile is out of the tab order (logo-tile.tsx's rule). */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={open}
                disabled={busy}
                data-document-tile="empty"
                className={cx(TILE, 'cursor-pointer border-dashed text-[12px] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink disabled:cursor-wait')}
              >
                {busy ? '…' : 'Add'}
              </button>
              <RowIcon icon="plus" label="Upload PDF" variant="primary" onClick={open} disabled={busy} />
            </>
          )
        }
      />
    </LedgerRow>
  )
}
