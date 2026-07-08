'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

export type AddField = {
  name: string
  placeholder: string
  type?: string
  required?: boolean
  /** Consecutive fields sharing a `row` sit side by side. */
  row?: number
  /** Width within its row: sm (fixed narrow, e.g. price), grow (fill), or full (default). */
  width?: 'sm' | 'grow' | 'full'
}

/** Automatic mode: paste a URL, `resolve` returns field `values` to prefill (or an
 *  error). Value keys prefixed `_` are preview-only (not submitted). */
export type AutoConfig = {
  placeholder: string
  resolve: (url: string) => Promise<{ error: string } | { values: Record<string, string> }>
}

/** Render the fields, grouping ones that share a `row`. */
function Fields({
  fields,
  values,
  set,
}: {
  fields: AddField[]
  values: Record<string, string>
  set: (name: string, v: string) => void
}) {
  const rows: AddField[][] = []
  for (const f of fields) {
    const last = rows[rows.length - 1]
    if (f.row != null && last && last[0].row === f.row) last.push(f)
    else rows.push([f])
  }
  return (
    <>
      {rows.map((group, i) => (
        <div key={i} className={group.length > 1 ? 'flex gap-2' : ''}>
          {group.map((f, j) => (
            <input
              key={f.name}
              autoFocus={i === 0 && j === 0}
              type={f.type ?? 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, e.target.value)}
              placeholder={f.placeholder}
              required={f.required}
              className={cx(inputClass, f.width === 'sm' ? 'w-24' : f.width === 'grow' ? 'min-w-0 flex-1' : 'w-full')}
            />
          ))}
        </div>
      ))}
    </>
  )
}

/**
 * The "Add" control shared by videos / merch / tour: a toolbar button that opens a
 * two-pane modal (live preview on the left, tight-sized fields on the right). When
 * `auto` is set, the modal opens on a Manual / Automatic choice — Automatic takes a
 * pasted URL and prefills the fields (video oEmbed, merch Open-Graph). Styled with
 * the site primitives (buttonClass / inputClass / Icon), so it matches everything else.
 */
export function CreateModal({
  kind,
  title,
  fields,
  preview,
  submit,
  auto,
}: {
  /** Mono eyebrow label above the title, e.g. "Tour date" / "Video" / "Product". */
  kind: string
  title: string
  fields: AddField[]
  preview: (values: Record<string, string>) => ReactNode
  submit: (formData: FormData) => Promise<unknown>
  auto?: AutoConfig
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'choose' | 'auto' | 'manual'>(auto ? 'choose' : 'manual')
  const [values, setValues] = useState<Record<string, string>>({})
  const [urlInput, setUrlInput] = useState('')
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setStep(auto ? 'choose' : 'manual')
    setValues({})
    setUrlInput('')
    setResolved(false)
    setError(null)
  }
  function close() {
    setOpen(false)
    reset()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (name: string, v: string) => setValues((p) => ({ ...p, [name]: v }))

  function loadUrl() {
    if (!auto || !urlInput.trim() || pending) return
    setError(null)
    start(async () => {
      const res = await auto.resolve(urlInput.trim())
      if ('error' in res) {
        setError(res.error)
        return
      }
      setValues((p) => ({ ...p, ...res.values }))
      setResolved(true)
    })
  }

  function add() {
    if (pending) return
    setError(null)
    const fd = new FormData()
    for (const f of fields) fd.set(f.name, values[f.name] ?? '')
    start(async () => {
      const res = (await submit(fd)) as { error?: string } | void
      if (res && typeof res === 'object' && 'error' in res && res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      close()
    })
  }

  const showForm = step === 'manual' || (step === 'auto' && resolved)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add"
        aria-label="Add"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        {/* Label collapsed until hover, then slides open to the left (matches Music Refresh). */}
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[70px] group-hover:pl-1 group-hover:pr-1.5">
          Add
        </span>
        <Icon name="plus" size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="w-[520px] max-w-full rounded-2xl bg-paper p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              {step !== 'choose' && auto && (
                <button
                  type="button"
                  onClick={() => {
                    setStep('choose')
                    setResolved(false)
                    setError(null)
                  }}
                  aria-label="Back"
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  <Icon name="chevronLeft" size={15} />
                </button>
              )}
              <div className="min-w-0">
                <KLabel>{kind}</KLabel>
                <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">{title}</h2>
              </div>
            </div>

            {/* Step 1 — Manual / Automatic, two columns, minimal */}
            {step === 'choose' && auto && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setStep('auto')}
                  className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  <Icon name="bolt" size={24} />
                  <span className="text-sm font-semibold">Auto</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('manual')}
                  className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  <Icon name="edit" size={22} />
                  <span className="text-sm font-semibold">Manual</span>
                </button>
              </div>
            )}

            {/* Automatic — paste a URL, load it in */}
            {step === 'auto' && !resolved && auto && (
              <div className="mt-4">
                <input
                  autoFocus
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadUrl()}
                  placeholder={auto.placeholder}
                  className={`${inputClass} w-full`}
                />
                {error && <p className="mt-2 font-space text-xs text-accent-red">{error}</p>}
                <div className="mt-5 flex justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={close} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  <button type="button" onClick={loadUrl} disabled={!urlInput.trim() || pending} className={buttonClass('solid')}>
                    {pending ? 'Loading…' : 'Load'}
                  </button>
                </div>
              </div>
            )}

            {/* Two-pane — live preview + fields */}
            {showForm && (
              <>
                <div className="mt-4 flex gap-4">
                  <div className="flex-none">{preview(values)}</div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Fields fields={fields} values={values} set={set} />
                  </div>
                </div>
                {error && <p className="mt-2 font-space text-xs text-accent-red">{error}</p>}
                <div className="mt-5 flex justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={close} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  <button type="button" onClick={add} disabled={pending} className={buttonClass('solid')}>
                    {pending ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
