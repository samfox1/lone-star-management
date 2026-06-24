/**
 * A small integration panel: save the artist's external id/name and pull its
 * catalog into draft rows. Used for Spotify and Bandsintown — the save/pull
 * server actions are passed in already bound to the artist.
 */
type BoundAction = (formData: FormData) => void | Promise<void>

export function SyncPanel({
  title,
  idName,
  idValue,
  placeholder,
  hasId,
  pullLabel,
  saveAction,
  pullAction,
}: {
  title: string
  idName: string
  idValue: string
  placeholder: string
  hasId: boolean
  pullLabel: string
  saveAction: BoundAction
  pullAction: BoundAction
}) {
  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <form action={pullAction}>
          <button
            type="submit"
            disabled={!hasId}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {pullLabel}
          </button>
        </form>
      </div>
      <form action={saveAction} className="mt-3 flex items-center gap-2">
        <input
          name={idName}
          defaultValue={idValue}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
        <button
          type="submit"
          className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Save
        </button>
      </form>
      <p className="mt-2 text-xs text-zinc-400">
        Pulls into draft rows. Your manual edits are never overwritten. Requires
        API credentials configured.
      </p>
    </section>
  )
}
