'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/ui'
import { publishSiteAction } from '../../actions'

/** One row: publish only when needed. Everything else lives in the sections. */
export function SeoTopRow({ artistId, unpublished }: { artistId: string; unpublished: boolean }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  if (!unpublished && !done) return null
  return (
    <div className="flex items-center justify-end gap-3">
      {done ? (
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Published</span>
      ) : (
        <>
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.12em] text-status-pending">Unpublished changes</span>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await publishSiteAction(artistId)
                setDone(true)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Publishing…' : 'Publish site'}
          </Button>
        </>
      )}
    </div>
  )
}
