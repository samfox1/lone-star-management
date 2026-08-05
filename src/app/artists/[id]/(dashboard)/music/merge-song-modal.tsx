'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CardModal } from '../card-modal'
import { toast } from '../toast'
import { mergeSongsAction } from './actions'

/** A song this one can be merged into (id + title, for the selector). */
export type MergeTarget = { id: string; title: string }

/**
 * "Merge into…" — fold a duplicate song into the one that should survive.
 *
 * Duplicates are produced deliberately: the platform sync REFUSES a title-only match when
 * either side has no duration, because a wrong automatic merge loses a song silently and
 * a refusal only leaves a spare row. This is where the manager finishes the job.
 *
 * DIRECTION: the song this control belongs to is the one that DISAPPEARS; the selected
 * song survives and gains the missing platform links. The confirm names both, in that
 * order, because getting it backwards deletes the wrong row and there is no undo.
 *
 * Refusals from the server (conflicting platform ids, a vanished row) surface as their
 * own toast rather than a generic failure — the message tells the manager what to clear
 * before retrying.
 */
export function MergeSongModal({
  open,
  onClose,
  artistId,
  song,
  targets,
}: {
  open: boolean
  onClose: () => void
  artistId: string
  /** The song being merged AWAY — deleted once its links are moved. */
  song: { id: string; title: string }
  targets: MergeTarget[]
}) {
  const router = useRouter()
  const [keepId, setKeepId] = useState('')
  const [merging, setMerging] = useState(false)
  // `merging` is STATE: two fast clicks both read the pre-render value and fire the merge
  // twice, and the second one runs against a row the first already deleted. The ref is the
  // actual latch; the state only drives the label. Same shape as CardModal's delete.
  const mergingRef = useRef(false)

  async function merge() {
    if (merging || mergingRef.current) return
    if (!keepId) {
      toast('Pick the song to keep.', 'error')
      return
    }
    const keeper = targets.find((t) => t.id === keepId)
    // Destructive and irreversible: one of these two rows is about to stop existing.
    if (
      !window.confirm(
        `Merge “${song.title}” into “${keeper?.title ?? 'the selected song'}”?\n\n` +
          `“${song.title}” will be deleted and its links moved across. This can't be undone.`,
      )
    )
      return

    mergingRef.current = true
    setMerging(true)
    try {
      const res = await mergeSongsAction(artistId, keepId, song.id)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      toast('Songs merged')
      onClose()
      router.refresh()
    } catch {
      toast("Couldn't merge those songs.", 'error')
    } finally {
      // In `finally` so one transient failure doesn't leave the button permanently dead.
      mergingRef.current = false
      setMerging(false)
    }
  }

  return (
    <CardModal
      open={open}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-paper px-5 py-2.5 font-space text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={merge}
            disabled={merging}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {merging ? 'Merging…' : 'Merge'}
          </button>
        </div>
      }
    >
      <div className="space-y-5 font-space">
        <h3 className="text-lg font-bold tracking-[-0.01em]">Merge song</h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">{song.title}</span> will be deleted, and its
          platform links and details moved onto the song you keep.
        </p>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Keep this song</span>
          <select
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
            className="block w-full rounded-lg border border-hairline bg-paper px-2.5 py-2 font-space text-sm text-ink outline-none focus:border-ink-faint"
          >
            <option value="">— Choose a song —</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </CardModal>
  )
}
