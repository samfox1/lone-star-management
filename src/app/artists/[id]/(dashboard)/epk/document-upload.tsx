'use client'

import { DOCUMENTS_FOLDER, type PressDocumentKind } from '@/lib/epk'
import { DOCUMENT_UPLOAD_RULES } from '@/lib/upload'
import { buttonClass } from '@/components/ui/ui'
import { FileDropField } from '../file-drop-field'
import { toast } from '../toast'
import { useStorageUpload } from '../use-storage-upload'
import { savePressDocumentAction } from './actions'

/**
 * One press-document slot: the stage plot or the tech rider.
 *
 * Uploads go to the PRIVATE `documents` bucket, so unlike every other uploader on the
 * dashboard there is no preview and no link — the file is not reachable from a browser by
 * design. The manager sees that it is set, and it reaches a promoter only by being merged
 * into the generated press kit.
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
  const { busy, error, upload } = useStorageUpload({
    bucket: 'documents',
    artistId,
    category: DOCUMENTS_FOLDER,
    noun: 'document',
    rules: DOCUMENT_UPLOAD_RULES,
    successMessage: `${label} uploaded`,
    writeRow: async (path) => (await savePressDocumentAction(artistId, kind, path)).error ?? null,
  })

  async function clear() {
    const res = await savePressDocumentAction(artistId, kind, null)
    // Surfaced, not swallowed: a Remove blocked by RLS must not look like it worked.
    if (res.error) {
      toast(res.error, 'error')
      return
    }
    toast(`${label} removed`)
  }

  return (
    <div className="space-y-2">
      {present && (
        <div className="flex items-center gap-3 rounded-lg border border-hairline px-3 py-2">
          <span className="flex-1 font-space text-xs text-ink-muted">
            {label} attached — it rides in the press kit PDF.
          </span>
          <button type="button" onClick={clear} className={buttonClass('ghost')}>
            Remove
          </button>
        </div>
      )}
      <FileDropField
        accept="application/pdf"
        label={present ? `Replace ${label.toLowerCase()}` : label}
        hint={hint}
        busy={busy}
        error={error}
        onFile={upload}
      />
    </div>
  )
}
