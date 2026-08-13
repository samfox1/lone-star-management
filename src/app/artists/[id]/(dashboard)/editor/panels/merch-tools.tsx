import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type EditorMerch } from '../inspector-types'
import { INVALID_RING } from '../inspector-shared'
import { AddLink } from '../inspector-grid'
import { useDebouncedFieldSave } from '../use-debounced-field-save'
import { updateContentAction } from '../../actions'

/* ── Merch tools: edit title / price / url, remove (no reorder — no sort_order) ─ */
export function MerchTools({
  merch,
  artistId,
  onRemove,
}: {
  merch: EditorMerch[]
  artistId: string
  onRemove: (m: EditorMerch) => void
}) {
  type Fields = { title: string; price: string; url: string }
  const [values, setValues] = useState<Record<string, Fields>>(() =>
    Object.fromEntries(merch.map((m) => [m.id, { title: m.title, price: m.price, url: m.url }])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())

  // Title is required; price must be blank or a number — else the write is dropped server-side.
  const badFields = (v: Fields) => ({
    title: v.title.trim() === '',
    price: v.price.trim() !== '' && Number.isNaN(Number(v.price)),
  })

  // The pending row is what the (unmount) flush persists — no separate values ref.
  const { status, save } = useDebouncedFieldSave<Fields>({
    persist: (id, v) => {
      const fd = new FormData()
      fd.set('title', v.title)
      fd.set('price', v.price)
      fd.set('url', v.url)
      return updateContentAction('merch', id, artistId, fd)
    },
    normalize: (v) => {
      const bad = badFields(v)
      return !bad.title && !bad.price ? v : null
    },
  })

  function edit(id: string, patch: Partial<Fields>) {
    const row: Fields = { ...(values[id] ?? { title: '', price: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const ok = save(id, row)
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const control =
    'w-full rounded-md border border-hairline px-2.5 py-1.5 font-space text-[13px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:border-ink-faint'

  return (
    <div className="space-y-2.5 px-5 py-4">
      {merch.map((m, i) => (
        <div key={m.id} className="flex items-start gap-2.5 rounded-lg border border-hairline p-2.5">
          <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-md bg-track text-ink-faint">
            {m.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="merch" size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              aria-label={`Product ${i + 1} name`}
              aria-invalid={(invalid.has(m.id) && !values[m.id]?.title.trim()) || undefined}
              value={values[m.id]?.title ?? ''}
              onChange={(e) => edit(m.id, { title: e.target.value })}
              placeholder="Item name"
              className={cx(control, invalid.has(m.id) && !values[m.id]?.title.trim() && INVALID_RING)}
            />
            <div className="flex gap-1.5">
              <input
                aria-label={`Product ${i + 1} price`}
                aria-invalid={
                  (invalid.has(m.id) && badFields(values[m.id] ?? { title: '', price: '', url: '' }).price) ||
                  undefined
                }
                value={values[m.id]?.price ?? ''}
                onChange={(e) => edit(m.id, { price: e.target.value })}
                placeholder="Price"
                inputMode="decimal"
                className={cx(
                  control,
                  'w-20 flex-none',
                  invalid.has(m.id) &&
                    badFields(values[m.id] ?? { title: '', price: '', url: '' }).price &&
                    INVALID_RING,
                )}
              />
              <input
                aria-label={`Product ${i + 1} URL`}
                type="url"
                value={values[m.id]?.url ?? ''}
                onChange={(e) => edit(m.id, { url: e.target.value })}
                placeholder="https://…"
                className={cx(control, 'min-w-0 flex-1 font-space text-xs text-ink-muted')}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={`Remove product ${i + 1}`}
            onClick={() => onRemove(m)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <AddLink href={`/artists/${artistId}/merch`} label="Add product" />

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}
