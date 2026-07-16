'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'

/**
 * A yes/no toggle that posts a real boolean into a form. The HIDDEN input is the
 * point: a native checkbox posts nothing when unchecked, so extractUpdate would read
 * the field as absent and never write `false` — a toggle you could turn on but never
 * off. This always posts 'true' or 'false' under `name` (content-form coerces it), so
 * turning it off is a real, saveable change.
 *
 * Uncontrolled like a native `defaultChecked` input, so it resets with the modal it
 * lives in (CardModal / CreateModal both unmount their children on close). `onChange`
 * lets CreateModal — which builds FormData from its own values map rather than a real
 * <form> — mirror the state.
 */
export function BoolToggle({
  name,
  label,
  defaultChecked = false,
  onChange,
}: {
  name: string
  label: string
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
}) {
  const [on, setOn] = useState(defaultChecked)

  function toggle() {
    const next = !on
    setOn(next)
    onChange?.(next)
  }

  return (
    <>
      <input type="hidden" name={name} value={on ? 'true' : 'false'} />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-space text-xs transition-colors',
          on ? 'border-accent bg-accent-soft text-accent' : 'border-hairline bg-paper text-ink-muted hover:text-ink',
        )}
      >
        <span
          className={cx(
            'inline-flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border',
            on ? 'border-accent bg-accent text-white' : 'border-hairline text-transparent',
          )}
        >
          <Icon name="check" size={11} strokeWidth={2.4} />
        </span>
        {label}
      </button>
    </>
  )
}
