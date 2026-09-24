'use client'

import { useRouter } from 'next/navigation'
import { publishBrandWithPasswordAction } from '../../actions'
import { revertBrandAction } from '../actions'
import { PublishRiser } from './publish-riser'

/**
 * The Brand tabs' Publish bar, bound to the brand publish (logos, icons, fonts —
 * `publishBrandWithPasswordAction`) and its Revert (`revertBrandAction`, back to what the
 * site shows). Rendered once by brand/layout.tsx, so it is the same bar on every Brand
 * tab and survives a tab switch.
 *
 * Revert is offered only when `canRevert` (loadBrandPending): with nothing ever published,
 * or only kinds that were never published changed, there is nothing to go back to, and a
 * button that can only say so reads as broken. A refusal comes back as `{ error }` and
 * PublishRiser shows it as an error toast; a revert that still restored NOTHING (a race
 * with a publish elsewhere) is reported the same way, never passed off as a success.
 */
export function BrandRiser({
  artistId,
  dirty,
  message,
  canRevert,
}: {
  artistId: string
  dirty: boolean
  message: string
  /** Revert would change something (lib/brand.ts `brandPending`). */
  canRevert: boolean
}) {
  const router = useRouter()
  return (
    <PublishRiser
      dirty={dirty}
      message={message}
      noun="brand"
      onPublish={async (password) => {
        const res = await publishBrandWithPasswordAction(artistId, password)
        if (res.ok) router.refresh()
        return res
      }}
      onRevert={
        canRevert
          ? async () => {
              const res = await revertBrandAction(artistId)
              if (res.error) return { error: res.error }
              if (res.changed === 0) return { error: 'There was nothing to revert — the site already shows this.' }
              router.refresh()
            }
          : undefined
      }
    />
  )
}
