import type { PublishableEntity } from '@/lib/content'
import { buttonClass } from '@/components/ui/ui'
import { publishSectionAction } from './actions'
import { ActionButton } from './action-button'

/** A section page header with title + an optional per-section Publish button. */
export function SectionShell({
  title,
  publishType,
  artistId,
  children,
}: {
  title: string
  publishType?: PublishableEntity
  artistId: string
  children: React.ReactNode
}) {
  // No page title (Sam, 2026-08-28: the side panel names the tool; a repeated heading
  // and a rule under it were the "headers" he asked to lose). The action row stays.
  return (
    <section>
      <div className="flex items-center justify-end">
        {publishType && (
          <ActionButton
            action={publishSectionAction.bind(null, publishType, artistId)}
            savedMessage={`Published ${title.toLowerCase()}`}
            busyLabel="Publishing…"
            className={buttonClass('ghost')}
          >
            Publish {title.toLowerCase()}
          </ActionButton>
        )}
      </div>
      <div className="mt-4 space-y-8">{children}</div>
    </section>
  )
}
