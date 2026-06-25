'use client'

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
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
      >
        {sources.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Apply
      </button>
    </form>
  )
}
