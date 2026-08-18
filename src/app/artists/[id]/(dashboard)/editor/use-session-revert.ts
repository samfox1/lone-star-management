import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ManifestLinkRegion } from '@/lib/site-editor/manifest'
import {
  assignComponentSlotAction,
  restorePublishedAction,
  saveEditorFieldAction,
  saveEditorLinkAction,
  saveEditorStyleAction,
} from '../actions'
import { useSessionJournal } from './use-session-journal'
import type { EditorTextField, GalleryPhoto } from './inspector-types'

/**
 * "REVERT CHANGES", extracted whole (2026-08-18 inspector split): the session journal,
 * the paint wrappers that feed it, and the revert walk — ~110 lines that lived
 * interleaved with the hub's routing.
 *
 * PUBLISHED-FIRST (Sam, 2026-08-17: "it should still be there until I hit publish or
 * manually undo"): Revert restores the last published edition and survives refreshes.
 * The in-memory session-ledger walk remains only for a NEVER-published artist, where
 * there is nothing to restore to — the paint wrappers exist to feed that fallback:
 * every optimistic paint is the choke point all edits pass through BEFORE their save,
 * so recording there is what makes the ledger complete.
 */
export function useSessionRevert({
  artistId,
  textFields,
  styleValues,
  linkValues,
  linkRegions,
  photos,
  applySlotOptimistic,
  onApplyField,
  onApplyStyle,
  onApplyLink,
}: {
  artistId: string
  textFields: EditorTextField[]
  styleValues: Record<string, string>
  linkValues: Record<string, string>
  linkRegions: ManifestLinkRegion[]
  photos: GalleryPhoto[]
  /** The inspector's shared optimistic half of a slot placement (state + frame). */
  applySlotOptimistic: (role: string, photo: GalleryPhoto | null) => void
  onApplyField?: (key: string, value: string) => void
  onApplyStyle?: (key: string, className: string) => void
  onApplyLink?: (key: string, url: string) => void
}): {
  /** Paints that RECORD: use these as the panels' apply callbacks, never the raw ones. */
  paintField: (key: string, value: string) => void
  paintStyle: (key: string, className: string) => void
  paintLink: (key: string, url: string) => void
  /** Record a slot placement's before-value (placeInSlot calls this before applying). */
  recordSlot: (role: string, beforePhotoId: string | null) => void
  revertSession: () => Promise<void>
  reverting: boolean
  /** How many keys this session touched — drives the bar's visibility. */
  journalCount: number
} {
  const journal = useSessionJournal()
  const [reverting, setReverting] = useState(false)
  const router = useRouter()

  const paintStyle = useCallback(
    (key: string, className: string) => {
      journal.record({ kind: 'style', key, before: styleValues[key] ?? null })
      onApplyStyle?.(key, className)
    },
    [journal, styleValues, onApplyStyle],
  )
  const paintField = useCallback(
    (key: string, value: string) => {
      // Image fields also repaint via apply-field (their value is a URL, saved as a
      // storage path elsewhere) — those aren't journal-revertable v1, so skip them.
      const field = textFields.find((f) => f.key === key)
      if (field) journal.record({ kind: 'field', key, before: field.value })
      onApplyField?.(key, value)
    },
    [journal, textFields, onApplyField],
  )
  const paintLink = useCallback(
    (key: string, url: string) => {
      journal.record({ kind: 'link', key, before: linkValues[key] ?? '' })
      onApplyLink?.(key, url)
    },
    [journal, linkValues, onApplyLink],
  )
  const recordSlot = useCallback(
    (role: string, beforePhotoId: string | null) =>
      journal.record({ kind: 'slot', role, before: beforePhotoId }),
    [journal],
  )

  /**
   * No confirmation: this undoes what the manager just did, which is the cheap,
   * expected action. The dialog belongs in front of the one that reaches past the
   * session (Restore version, next to Publish).
   */
  async function revertSession() {
    if (reverting) return
    setReverting(true)
    try {
      const restored = await restorePublishedAction(artistId)
      if (restored.ok && restored.hasPublished) {
        router.refresh() // the draft changed under every panel — re-read it
        return
      }
      for (const e of [...journal.entries].reverse()) {
        if (e.kind === 'style') {
          // before=null → save '' → the override row is DELETED, not written empty.
          onApplyStyle?.(e.key, e.before ?? '')
          await saveEditorStyleAction(artistId, e.key, e.before ?? '')
        } else if (e.kind === 'field') {
          onApplyField?.(e.key, e.before)
          await saveEditorFieldAction(artistId, e.key, e.before)
        } else if (e.kind === 'link') {
          onApplyLink?.(e.key, e.before)
          await saveEditorLinkAction(artistId, e.key, e.before, linkRegions.find((r) => r.key === e.key)?.label ?? e.key)
        } else {
          // Re-place the previous holder: the shared optimistic half, then an AWAITED
          // persist (not a transition — a revert must not skip mid-transition).
          const next = e.before ? (photos.find((p) => p.id === e.before) ?? null) : null
          applySlotOptimistic(e.role, next)
          await assignComponentSlotAction(artistId, e.role, next?.id ?? null)
        }
      }
    } finally {
      journal.clear()
      setReverting(false)
    }
  }

  return { paintField, paintStyle, paintLink, recordSlot, revertSession, reverting, journalCount: journal.count }
}
