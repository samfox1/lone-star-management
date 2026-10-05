'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CardModal } from '../card-modal'
import { CANCEL_WORD, useConfirm } from '../confirm-dialog'
import { KvRow, SelectMenu } from '../modal-kit'
import { toast } from '../toast'
import { mergeSongsAction } from './actions'

/** A song that can be merged into. `release_id` lets the song modal tell an intended twin
 *  (the same song on another release — one row per release, 2026-09-11) from a real
 *  duplicate (same title on the SAME release, or with no release at all). */
export type MergeTarget = { id: string; title: string; release_id?: string | null }

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
 * The window is a few plain words naming the song (Sam, 2026-10-02: a title only to say WHICH
 * item) and one row, Keep: the dashboard's own drop-down on the row's line, no box. No sentence
 * restating what the confirm asks anyway.
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
  const { ask, dialog } = useConfirm()
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
    const go = await ask(
      `Merge “${song.title}” into “${keeper?.title ?? 'the selected song'}”? “${song.title}” will be deleted and its links moved across. This can't be undone.`,
      { action: 'Merge' },
    )
    if (!go) return

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
      // Which song goes, in a few plain words; the confirm spells out the rest.
      title={`Merge “${song.title}”`}
      label="Merge song"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className={CANCEL_WORD}>
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
      <div className="mt-5">
        <KvRow label="Keep">
          <SelectMenu
            label="Keep"
            value={keepId}
            options={targets.map((t) => ({ value: t.id, label: t.title }))}
            onChange={setKeepId}
          />
        </KvRow>
      </div>
      {dialog}
    </CardModal>
  )
}
