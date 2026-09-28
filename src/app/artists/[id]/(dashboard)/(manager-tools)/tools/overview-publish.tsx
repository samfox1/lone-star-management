'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/ui'
import { PublishPasswordDialog } from '../../publish-bar'
import { publishAction } from '../../actions'

/**
 * The Overview's "Publish all" (Sam, 2026-09-28): password-gated like every other
 * Publish. Opens the SAME password dialog every content page uses (publish-bar.tsx's
 * PublishPasswordDialog) rather than a copy, and hands the password to `publishAction`,
 * which verifies it server-side (`publishGated` / `verifyPasswordGate`) before publishing
 * anything — a client-only prompt is not a gate.
 */
export function OverviewPublish({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Publish all
      </Button>
      <PublishPasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        noun="site"
        onPublish={async (password) => {
          const res = await publishAction(artistId, password)
          if (res.ok) router.refresh()
          return res
        }}
      />
    </>
  )
}
