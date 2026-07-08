/**
 * Dashboard editor for one content type: an add form plus an editable row per
 * existing item, all wired to the generic content server actions. Field layout
 * per type lives in FIELD_UI so adding a column is a one-line change.
 */
import type { GenericEntity, ContentRow } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { addContentAction, updateContentAction } from './actions'
import { DeleteButton } from './delete-button'
import { TrackAudioUploader } from './track-audio-uploader'

type FieldUI = { name: string; placeholder: string; type?: string; width?: string }

const FIELD_UI: Record<GenericEntity, { heading: string; fields: FieldUI[] }> = {
  track: {
    heading: 'Tracks',
    fields: [{ name: 'title', placeholder: 'Track title' }],
  },
  tour_date: {
    heading: 'Tour dates',
    fields: [
      { name: 'date', placeholder: 'Date', type: 'date', width: 'w-40' },
      { name: 'venue', placeholder: 'Venue' },
      { name: 'city', placeholder: 'City', width: 'w-32' },
      { name: 'ticket_url', placeholder: 'Tickets URL', type: 'url', width: 'w-44' },
    ],
  },
  merch: {
    heading: 'Merch',
    fields: [
      { name: 'title', placeholder: 'Item name' },
      { name: 'price', placeholder: 'Price', type: 'number', width: 'w-24' },
      { name: 'url', placeholder: 'Buy URL', type: 'url', width: 'w-44' },
      { name: 'image_url', placeholder: 'Image URL', type: 'url', width: 'w-44' },
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

export function ContentSection({
  type,
  artistId,
  rows,
}: {
  type: GenericEntity
  artistId: string
  rows: ContentRow[]
}) {
  const ui = FIELD_UI[type]

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">{ui.heading}</h2>
        <span className="font-space text-xs text-ink-faint">{rows.length} total</span>
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
        <button type="submit" className={buttonClass('solid')}>
          Add
        </button>
      </form>

      {/* Edit / delete */}
      {rows.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li
              key={row.id as string}
              className="flex items-center gap-2 rounded-xl border border-hairline bg-paper px-3 py-2"
            >
              {type === 'merch' && (
                <div className="h-10 w-10 flex-none overflow-hidden rounded-md border border-hairline bg-surface">
                  {row.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={String(row.image_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-ink-faint">
                      <Icon name="merch" size={18} />
                    </span>
                  )}
                </div>
              )}
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
                  <span className="rounded bg-surface px-1.5 py-0.5 font-space text-[10px] uppercase tracking-[0.04em] text-ink-faint">
                    {row.source as string}
                  </span>
                )}
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  Save
                </button>
              </form>
              {type === 'track' && (
                <TrackAudioUploader
                  artistId={artistId}
                  trackId={row.id as string}
                  hasAudio={!!row.audio_path}
                />
              )}
              <DeleteButton
                type={type}
                id={row.id as string}
                artistId={artistId}
                noun="Item"
                className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
              >
                Delete
              </DeleteButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
          None yet.
        </p>
      )}
    </section>
  )
}
