'use client'
import { useState } from 'react'
import { buttonClass } from '@/components/ui/ui'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={buttonClass('ghost', 'px-2.5 py-1 text-[11px]')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}
