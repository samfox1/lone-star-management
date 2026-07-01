'use client'

import { useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import { APPLICATION_STATUSES, setApplicationStatus } from './actions'

/** Inline status control for one application; updates via the server action. */
export function StatusSelect({ id, current }: { id: string; current: string }) {
  const [value, setValue] = useState(current)
  const [pending, startTransition] = useTransition()

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value
        setValue(next)
        startTransition(() => setApplicationStatus(id, next))
      }}
      className={cx(
        'flex-none rounded-lg border border-hairline bg-paper px-2.5 py-1.5 font-space text-xs text-ink outline-none focus:border-ink-faint',
        pending && 'opacity-50',
      )}
    >
      {APPLICATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}
