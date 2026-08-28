'use client'

import { AuditPanel } from '../audit-panel'

/** Run the check. The external testers live in the top row's "Test with" menu. */
export function TestSection({ artistId, siteUrl }: { artistId: string; siteUrl: string | null }) {
  return (
    <div className="mx-auto max-w-4xl">
      <AuditPanel artistId={artistId} siteUrl={siteUrl} />
    </div>
  )
}
