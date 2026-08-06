'use client'

import { useStorageUpload } from './use-storage-upload'
import { useBudgetGate } from './budget-gate'
import { FileDropField } from './file-drop-field'
import type { UploadRules } from '@/lib/upload'
import type { AssetBudget, UploadKind } from '@/lib/site-editor/asset-budget'

/**
 * THE upload control: a drop field, the storage dance, and the compression gate, in one
 * component.
 *
 * Every uploader in the dashboard was independently assembling the same three pieces —
 * `FileDropField` + `useStorageUpload` + (since 2026-08-06) `useBudgetGate`. Seven call
 * sites, seven chances to wire two of the three and ship the third silently. That is not
 * hypothetical: the editor's hero-image / profile-photo modal was written the same day as
 * the gate and never got one, so an oversized photo placed from the editor bypassed
 * compression entirely while the identical photo placed from the Images panel did not.
 *
 * Composing them here makes that shape unavailable. A caller supplies WHERE the file goes
 * (bucket/category/writeRow) and WHAT it may be (rules/budget); it cannot supply "a drop
 * field that skips the gate", because there is no seam to skip it at.
 *
 * `budget` absent or null = no gate, which is the pre-budget behaviour verbatim: the
 * dashboard pages have no site manifest in scope, so they pass nothing and keep their
 * plain byte caps.
 */
export function UploadField({
  accept,
  label,
  hint,
  disabled,
  budget,
  kind,
  ...upload
}: {
  accept: string
  label: string
  hint?: string
  disabled?: boolean
  bucket: string
  artistId: string
  category: string
  noun: string
  rules?: UploadRules
  resumable?: boolean
  successMessage?: string
  writeRow: (path: string, file: File) => Promise<string | null>
  onSuccess?: () => void
} & (
  | {
      /** Which gate to apply. Images compress; video and fonts gate with instructions. */
      kind: UploadKind
      /** The site's budget for this kind/slot (manifest.assetBudgets). Null when the
       *  site declares none, or when there is no manifest in scope (the dashboard
       *  pages) — the gate is then inert and the plain byte caps still apply. */
      budget?: AssetBudget | null
    }
  // Neither, for uploads no budget can describe: PDFs and track audio. Paired in the
  // type so `budget` can never arrive without the `kind` that decides how to honour it.
  | { kind?: undefined; budget?: undefined }
)) {
  const { busy, error, progress, upload: send } = useStorageUpload(upload)
  const gate = useBudgetGate(kind, budget)

  return (
    <>
      <FileDropField
        accept={accept}
        label={label}
        hint={hint}
        busy={busy}
        progress={progress}
        error={error}
        disabled={disabled}
        onFile={async (file) => {
          // The gate resolves with the file to ACTUALLY store — the original, a smaller
          // re-encode, or null when the manager cancelled or the kind cannot be shrunk.
          const prepared = await gate.prepare(file)
          if (prepared) await send(prepared)
        }}
      />
      {gate.modal}
    </>
  )
}
