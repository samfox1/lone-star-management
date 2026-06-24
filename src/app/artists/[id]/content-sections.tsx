/**
 * Dashboard editor for one content type: an add form plus an editable row per
 * existing item, all wired to the generic content server actions. Field layout
 * per type lives in FIELD_UI so adding a column is a one-line change.
 */
import type { EntityType, ContentRow } from '@/lib/content'
import {
  addContentAction,
  deleteContentAction,
  updateContentAction,
} from './actions'

type FieldUI = { name: string; placeholder: string; type?: string; width?: string }

const FIELD_UI: Record<EntityType, { heading: string; fields: FieldUI[] }> = {
  track: {
    heading: 'Tracks',
    fields: [{ name: 'title', placeholder: 'Track title' }],
  },
  tour_date: {
    heading: 'Tour dates',
    fields: [
      { name: 'date', placeholder: 'Date', type: 'date', width: 'w-40' },
      { name: 'venue', placeholder: 'Venue' },
      { name: 'city', placeholder: 'City', width: 'w-40' },
    ],
  },
  merch: {
    heading: 'Merch',
    fields: [
      { name: 'title', placeholder: 'Item name' },
      { name: 'price', placeholder: 'Price', type: 'number', width: 'w-24' },
    ],
  },
  link: {
    heading: 'Links',
    fields: [
      { name: 'label', placeholder: 'Label', width: 'w-40' },
      { name: 'url', placeholder: 'https://…', type: 'url' },
    ],
  },
}

const inputClass =
  'min-w-0 rounded-md border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100'

export function ContentSection({
  type,
  artistId,
  rows,
}: {
  type: EntityType
  artistId: string
  rows: ContentRow[]
}) {
  const ui = FIELD_UI[type]

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {ui.heading}
        </h2>
        <span className="text-sm text-zinc-400">{rows.length} total</span>
      </div>

      {/* Add */}
      <form
        action={addContentAction.bind(null, type, artistId)}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        {ui.fields.map((f, i) => (
          <input
            key={f.name}
            name={f.name}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            required={i === 0}
            className={`${inputClass} ${f.width ?? 'flex-1'}`}
          />
        ))}
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Add
        </button>
      </form>

      {/* Edit / delete */}
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id as string}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <form
                action={updateContentAction.bind(null, type, row.id as string, artistId)}
                className="flex flex-1 flex-wrap items-center gap-2"
              >
                {ui.fields.map((f, i) => (
                  <input
                    key={f.name}
                    name={f.name}
                    type={f.type ?? 'text'}
                    defaultValue={(row[f.name] as string | number | null) ?? ''}
                    required={i === 0}
                    className={`${inputClass} ${f.width ?? 'flex-1'}`}
                  />
                ))}
                {row.source !== undefined && row.source !== 'manual' && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    {row.source as string}
                  </span>
                )}
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Save
                </button>
              </form>
              <form
                action={deleteContentAction.bind(null, type, row.id as string, artistId)}
              >
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          None yet.
        </p>
      )}
    </section>
  )
}
