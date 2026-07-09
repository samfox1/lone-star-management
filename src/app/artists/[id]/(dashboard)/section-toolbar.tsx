'use client'

import { useState, type ReactNode } from 'react'
import { KLabel, buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { ActionButton } from './action-button'

type PublishAction = () => Promise<{ error?: string }>

/**
 * One compact toolbar for a content grid: the count on the left, and (optional)
 * Import / Publish / + Add on the right. The add form and the import panel are
 * passed as children/slots and stay tucked away until toggled, so nothing wastes
 * vertical space above the grid. Shared by the Tracks and Releases views so both
 * halves of the Music tab read identically.
 */
export function SectionToolbar({
  count,
  singular,
  plural,
  publishAction,
  publishLabel = 'Publish',
  addLabel,
  importPanel,
  children,
}: {
  count: number
  singular: string
  plural: string
  publishAction: PublishAction
  publishLabel?: string
  /** aria-label for the + button (e.g. "Add track"). */
  addLabel: string
  importPanel?: ReactNode
  /** The add form, revealed by the + button. */
  children: ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <KLabel>
          {count} {count === 1 ? singular : plural}
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
        <ActionButton
          action={publishAction}
          savedMessage={`${publishLabel}ed`}
          busyLabel="Publishing…"
          className={buttonClass('ghost')}
        >
          {publishLabel}
        </ActionButton>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title={addLabel}
          aria-label={addLabel}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-ink text-white transition-colors hover:bg-black"
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      {adding && <div className="mt-3">{children}</div>}

      {importing && importPanel && (
        <div className="mt-3 rounded-xl border border-hairline bg-paper p-4">{importPanel}</div>
      )}
    </div>
  )
}
