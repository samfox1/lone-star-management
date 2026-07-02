'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { KLabel, buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

type BoundAction = (formData: FormData) => void | Promise<void>

/**
 * One compact toolbar for the Tracks page: the count on the left, and Import /
 * Publish / + Add on the right — the import (catalog source + sync) and add-track
 * controls stay tucked away until toggled, so no vertical space is wasted above
 * the grid.
 */
export function TracksHeader({
  count,
  addAction,
  publishAction,
  importPanel,
}: {
  count: number
  addAction: BoundAction
  publishAction: BoundAction
  importPanel: ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <KLabel>
          {count} {count === 1 ? 'track' : 'tracks'}
        </KLabel>
        <div className="flex-1" />
        {importPanel && (
          <button
            type="button"
            onClick={() => setImporting((v) => !v)}
            className={buttonClass('ghost', importing ? 'border-ink-faint' : undefined)}
          >
            Import
          </button>
        )}
        <form action={publishAction}>
          <button type="submit" className={buttonClass('ghost')}>
            Publish
          </button>
        </form>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="Add track"
          aria-label="Add track"
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-ink text-white transition-colors hover:bg-black"
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {adding && (
        <form action={addAction} className="mt-3 flex items-center gap-2">
          <input name="title" placeholder="Track title" required autoFocus className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      )}

      {importing && importPanel && (
        <div className="mt-3 rounded-xl border border-hairline bg-paper p-4">{importPanel}</div>
      )}
    </div>
  )
}
