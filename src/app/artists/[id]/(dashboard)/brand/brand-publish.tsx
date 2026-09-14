'use client'

import { useRouter } from 'next/navigation'
import { publishBrandWithPasswordAction } from '../actions'
import { PublishBar } from '../publish-bar'

/** The floating Publish every content page has, for the logos, tab icon and fonts. */
export function BrandPublish({ artistId, dirty }: { artistId: string; dirty: boolean }) {
  const router = useRouter()
  return (
    <PublishBar
      pendingCount={0}
      dirty={dirty}
      noun="brand"
      onPublish={async (password) => {
        const res = await publishBrandWithPasswordAction(artistId, password)
        if (res.ok) router.refresh()
        return res
      }}
    />
  )
}
