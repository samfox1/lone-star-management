'use client'

import { buttonClass } from '@/components/ui/ui'

/**
 * Catalog-source selector. Switching is destructive (it deletes the previous
 * importer's tracks), so when the change would actually wipe imported tracks we
 * confirm first. Manual tracks are never affected, so a switch with nothing
 * imported (or to/from Manual) submits without a prompt.
 */
export function CatalogSourceForm({
  action,
  current,
  currentLabel,
  hasImportedTracks,
  sources,
}: {
  action: (formData: FormData) => void
  current: string
  currentLabel: string
  hasImportedTracks: boolean
  sources: { value: string; label: string }[]
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const next = new FormData(e.currentTarget).get('catalog_source')
        if (
          hasImportedTracks &&
          next !== current &&
          !window.confirm(
            `Switching will delete the tracks imported from ${currentLabel}. Your manual tracks stay. Continue?`,
          )
        ) {
          e.preventDefault()
        }
      }}
      className="mt-2 flex items-center gap-2"
    >
      <select
        name="catalog_source"
        defaultValue={current}
        className="rounded-lg border border-hairline bg-paper px-2.5 py-2 text-sm text-ink outline-none focus:border-ink-faint"
      >
        {sources.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass('ghost')}>
        Apply
      </button>
    </form>
  )
}
