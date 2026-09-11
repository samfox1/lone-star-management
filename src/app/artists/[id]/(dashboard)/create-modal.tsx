'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel, modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { UploadError } from './file-drop-field'
import { useLockBodyScroll } from './use-lock-body-scroll'
import { TagInput, joinTags, splitTags } from './tag-input'
import { BoolToggle } from './bool-toggle'
import { toast } from './toast'

export type AddField = {
  name: string
  placeholder: string
  type?: string
  required?: boolean
  /** Consecutive fields sharing a `row` sit side by side. */
  row?: number
  /** Width within its row: sm (fixed narrow, e.g. price), grow (fill), or full (default). */
  width?: 'sm' | 'grow' | 'full'
  /** `tags` = chip field (TagInput); `select` = dropdown of `options`; `toggle` = a
   *  yes/no BoolToggle whose label is the placeholder. */
  kind?: 'text' | 'tags' | 'select' | 'toggle'
  /** Choices for a `select` field. The placeholder is the empty first option. */
  options?: { value: string; label: string }[]
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
          {group.map((f, j) => {
            const width = cx(f.width === 'sm' ? 'w-24' : f.width === 'grow' ? 'min-w-0 flex-1' : 'w-full')
            // TagInput is uncontrolled and owns its chips; mirror them into `values`
            // as newline-joined text so add() can expand them back into one FormData
            // entry per tag. It remounts with the modal, so it resets like the rest.
            if (f.kind === 'tags') {
              return (
                <div key={f.name} className={width}>
                  <TagInput
                    name={f.name}
                    placeholder={f.placeholder}
                    onChange={(tags) => set(f.name, joinTags(tags))}
                  />
                </div>
              )
            }
            if (f.kind === 'toggle') {
              return (
                <div key={f.name} className={width}>
                  <BoolToggle name={f.name} label={f.placeholder} onChange={(c) => set(f.name, c ? 'true' : 'false')} />
                </div>
              )
            }
            if (f.kind === 'select') {
              return (
                <select
                  key={f.name}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  aria-label={f.placeholder}
                  className={cx(inputClass, width, values[f.name] ? 'text-ink' : 'text-ink-faint')}
                >
                  <option value="">{f.placeholder}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value} className="text-ink">
                      {o.label}
                    </option>
                  ))}
                </select>
              )
            }
            return (
              <input
                key={f.name}
                autoFocus={i === 0 && j === 0}
                type={f.type ?? 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
                placeholder={f.placeholder}
                required={f.required}
                className={cx(inputClass, width)}
              />
            )
          })}
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
/** The header "+" every page adds with: a plus that slides an "Add" label open on hover
 *  (matches Music Refresh). ONE definition — Sam (2026-09-11) caught the tour page's
 *  copy drifting from the merch page's. */
export function AddTrigger({ onClick, label = 'Add' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
    >
      <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[70px] group-hover:pl-1 group-hover:pr-1.5">
        {label}
      </span>
      <Icon name="plus" size={14} />
    </button>
  )
}

export function CreateModal({
  kind,
  title,
  fields,
  preview,
  submit,
  auto,
  upload,
}: {
  /** Mono eyebrow label above the title, e.g. "Tour date" / "Video" / "Product". */
  kind: string
  title: string
  fields: AddField[]
  preview: (values: Record<string, string>) => ReactNode
  submit: (formData: FormData) => Promise<unknown>
  auto?: AutoConfig
  /** Optional "Upload a file" path — renders your uploader; call `close` when done. */
  upload?: (close: () => void) => ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const hasChoice = Boolean(auto || upload)
  const [step, setStep] = useState<'choose' | 'auto' | 'manual' | 'upload'>(hasChoice ? 'choose' : 'manual')
  const [values, setValues] = useState<Record<string, string>>({})
  const [urlInput, setUrlInput] = useState('')
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // Re-entry latch for add(). `pending` is transition state: two fast clicks both read
  // the pre-update value and the manager gets two identical rows to clean up.
  const pendingRef = useRef(false)

  function reset() {
    setStep(hasChoice ? 'choose' : 'manual')
    setValues({})
    setUrlInput('')
    setResolved(false)
    setError(null)
  }
  function close() {
    setOpen(false)
    reset()
  }
  useLockBodyScroll(open)

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
    if (pending || pendingRef.current) return
    pendingRef.current = true
    setError(null)
    const fd = new FormData()
    for (const f of fields) {
      if (f.kind === 'tags') {
        // One entry per tag — the same shape TagInput's hidden inputs post inside a
        // real form (SaveForm), so the server reads both call sites identically. The
        // leading blank keeps the field PRESENT when there are no tags.
        fd.set(f.name, '')
        for (const tag of splitTags(values[f.name] ?? '')) fd.append(f.name, tag)
        continue
      }
      fd.set(f.name, values[f.name] ?? '')
    }
    start(async () => {
      try {
        const res = (await submit(fd)) as { error?: string } | void
        if (res && typeof res === 'object' && 'error' in res && res.error) {
          setError(res.error)
          return
        }
        router.refresh()
        close()
        toast(`${kind} added`)
      } finally {
        // Released on EVERY exit — an error path that kept the latch would make the
        // modal permanently unsubmittable after one rejected save.
        pendingRef.current = false
      }
    })
  }

  const showForm = step === 'manual' || (step === 'auto' && resolved)

  return (
    <>
      <AddTrigger onClick={() => setOpen(true)} />

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className={modalCardClass}>
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              {step !== 'choose' && hasChoice && (
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

            {/* Step 1 — pick a way in: Auto / Manual / Upload (whichever are wired) */}
            {step === 'choose' && hasChoice && (
              <div className={cx('mt-4 grid gap-2.5', auto && upload ? 'grid-cols-3' : 'grid-cols-2')}>
                {auto && (
                  <button
                    type="button"
                    onClick={() => setStep('auto')}
                    className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                  >
                    <Icon name="bolt" size={24} />
                    <span className="text-sm font-semibold">Auto</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep('manual')}
                  className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  <Icon name="edit" size={22} />
                  <span className="text-sm font-semibold">Manual</span>
                </button>
                {upload && (
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                  >
                    <Icon name="upload" size={22} />
                    <span className="text-sm font-semibold">Upload</span>
                  </button>
                )}
              </div>
            )}

            {/* Upload — caller's uploader (drop field); closes the modal on success */}
            {step === 'upload' && upload && <div className="mt-4">{upload(close)}</div>}

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
                {error && <div className="mt-3"><UploadError>{error}</UploadError></div>}
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
                {error && <div className="mt-3"><UploadError>{error}</UploadError></div>}
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
