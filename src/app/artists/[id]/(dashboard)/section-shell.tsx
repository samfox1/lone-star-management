import type { PublishableEntity } from '@/lib/content'
import { buttonClass } from '@/components/ui/ui'
import { publishSectionAction } from './actions'

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
  return (
    <section>
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">{title}</h1>
        {publishType && (
          <form action={publishSectionAction.bind(null, publishType, artistId)}>
            <button type="submit" className={buttonClass('ghost')}>
              Publish {title.toLowerCase()}
            </button>
          </form>
        )}
      </div>
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  )
}
