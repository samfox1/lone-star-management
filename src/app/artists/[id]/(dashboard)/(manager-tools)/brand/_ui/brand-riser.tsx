'use client'

import { useRouter } from 'next/navigation'
import { publishBrandWithPasswordAction } from '../../../actions'
import { revertBrandAction } from '../actions'
import { PublishRiser } from '../../_ui/publish-riser'
import { announceBrandRevert } from './brand-events'

/**
 * The Brand tabs' Publish bar, bound to the brand publish (logos, icons, fonts, colours and
 * the browser-bar colour — `publishBrandWithPasswordAction`) and its Revert (`revertBrandAction`, back to what the
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
              // Before the refresh: a tab holding its own copy (the Colors palette) re-seeds
              // from the props the refresh brings (brand-events.ts).
              announceBrandRevert()
              router.refresh()
            }
          : undefined
      }
    />
  )
}

/**
 * The bar's place when the "unpublished changes" check itself FAILED (2026-09-28). The
 * check cannot say whether anything is waiting, so the bar says that instead — a hidden bar
 * is what "everything is on the site" looks like. Reload runs the check again (a refresh
 * re-renders the layout). No Publish here: that is the bar's job once it knows what it
 * would publish.
 */
export function BrandCheckFailed() {
  const router = useRouter()
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-hairline bg-paper px-4 pt-[18px] pb-[calc(18px+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_rgba(0,0,0,0.05)] sm:px-8"
    >
      <p className="min-w-0 text-[15px] leading-snug text-accent-red">Couldn’t check for unpublished changes.</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="flex-none rounded-[10px] border border-hairline px-[18px] py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-hover"
      >
        Reload
      </button>
    </div>
  )
}
