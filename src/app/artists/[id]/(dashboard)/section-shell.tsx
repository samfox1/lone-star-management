import type { PublishableEntity } from '@/lib/content'
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
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {publishType && (
          <form action={publishSectionAction.bind(null, publishType, artistId)}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Publish {title.toLowerCase()}
            </button>
          </form>
        )}
      </div>
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  )
}
