'use client'

/**
 * AI visibility as a LEDGER (Sam, 2026-08-28, prototype round 4 / V02): one centred
 * column of rows like the tour dates — question on the left, its live answer on the
 * right, pencil + trash at the edge. Editing swaps the row's cells to inputs in place.
 * The five probe questions are fixed (their wording is the measurement); their answers
 * are automatic until written, and "remove" on one of them clears the written answer so
 * the automatic one returns. The manager's own questions are added at the bottom.
 */
import { useState } from 'react'
import { PROBE_VERSION, probePrompts } from '@samfox1/site-bridge/seo'
import { FAQ_EXTRA, FAQ_KEYS } from '@/lib/site-content-schema'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import { cx } from '@/lib/cx'
import { saveSeoFieldAction } from '../../../actions'

export { PROBE_VERSION, probePrompts }

type Row = { key: string; qKey?: string; question: string; answer: string; auto: string; fixed: boolean }

const INPUT = 'w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-ink-faint'
const ICON_BTN = 'inline-flex flex-none items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink'

export function AiSection({ artistId, name, schemaType, initial, auto }: { artistId: string; name: string; schemaType: string; initial: Record<string, string>; auto: string[] }) {
  const prompts = probePrompts(name, schemaType)
  const build = (v: Record<string, string>): Row[] => [
    ...prompts.map((question, i) => ({ key: FAQ_KEYS[i], question, answer: (v[FAQ_KEYS[i]] ?? '').trim(), auto: auto[i] ?? '', fixed: true })),
    ...FAQ_EXTRA.filter((e) => (v[e.q] ?? '').trim()).map((e) => ({ key: e.a, qKey: e.q, question: (v[e.q] ?? '').trim(), answer: (v[e.a] ?? '').trim(), auto: '', fixed: false })),
  ]
  const [values, setValues] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ q: string; a: string }>({ q: '', a: '' })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = build(values)
  const freeSlot = FAQ_EXTRA.find((e) => !(values[e.q] ?? '').trim())

  const persist = async (pairs: [string, string][]) => {
    for (const [k, val] of pairs) {
      const r = await saveSeoFieldAction(artistId, k, val)
      if (!r.ok) {
        setError(r.error ?? 'Could not save.')
        return false
      }
    }
    setError(null)
    return true
  }
  const startEdit = (row: Row) => {
    setAdding(false)
    setEditing(row.key)
    setDraft({ q: row.question, a: row.answer || row.auto })
  }
  const save = async (row: Row) => {
    const pairs: [string, string][] = row.fixed ? [[row.key, draft.a]] : [[row.qKey!, draft.q], [row.key, draft.a]]
    if (await persist(pairs)) {
      setValues((v) => ({ ...v, ...Object.fromEntries(pairs) }))
      setEditing(null)
    }
  }
  const remove = async (row: Row) => {
    const pairs: [string, string][] = row.fixed ? [[row.key, '']] : [[row.qKey!, ''], [row.key, '']]
    if (await persist(pairs)) setValues((v) => ({ ...v, ...Object.fromEntries(pairs) }))
  }
  const add = async () => {
    if (!freeSlot || !draft.q.trim()) return
    const pairs: [string, string][] = [[freeSlot.q, draft.q.trim()], [freeSlot.a, draft.a.trim()]]
    if (await persist(pairs)) {
      setValues((v) => ({ ...v, ...Object.fromEntries(pairs) }))
      setAdding(false)
      setDraft({ q: '', a: '' })
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="divide-y divide-hairline">
        {rows.map((row) =>
          editing === row.key ? (
            <div key={row.key} className="flex items-start gap-5 py-5">
              <div className="min-w-0 flex-[0_0_40%]">
                {row.fixed ? (
                  <div className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{row.question}</div>
                ) : (
                  <input aria-label="Question" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} className={cx(INPUT, 'font-semibold')} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <textarea aria-label={`Answer: ${row.question}`} value={draft.a} onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value }))} className={cx(INPUT, 'h-[68px] resize-none')} />
              </div>
              <div className="flex flex-none flex-col gap-1.5">
                <button type="button" onClick={() => save(row)} className={buttonClass('solid')}>
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className={buttonClass('ghost')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div key={row.key} className="flex items-center gap-5 py-5">
              <div className="min-w-0 flex-[0_0_40%] text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{row.question}</div>
              <div className={cx('min-w-0 flex-1 text-[15px] leading-relaxed', row.answer || row.auto ? 'text-ink-muted' : 'italic text-ink-faint')}>
                {row.answer || row.auto || 'No answer yet'}
              </div>
              <div className="flex flex-none items-center gap-2">
                <button type="button" onClick={() => startEdit(row)} aria-label={`Edit: ${row.question}`} className={ICON_BTN}>
                  <Icon name="edit" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  aria-label={row.fixed ? `Reset: ${row.question}` : `Remove: ${row.question}`}
                  disabled={row.fixed && !row.answer}
                  className={cx(ICON_BTN, 'hover:border-danger-border hover:text-accent-red disabled:opacity-30')}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ),
        )}
        {adding && (
          <div className="flex items-start gap-5 py-5">
            <div className="min-w-0 flex-[0_0_40%]">
              <input aria-label="New question" autoFocus value={draft.q} placeholder="A question people ask" onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} className={cx(INPUT, 'font-semibold')} />
            </div>
            <div className="min-w-0 flex-1">
              <textarea aria-label="New answer" value={draft.a} placeholder="The answer" onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value }))} className={cx(INPUT, 'h-[68px] resize-none')} />
            </div>
            <div className="flex flex-none flex-col gap-1.5">
              <button type="button" onClick={add} disabled={!draft.q.trim()} className={buttonClass('solid')}>
                Save
              </button>
              <button type="button" onClick={() => setAdding(false)} className={buttonClass('ghost')}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Centred (Sam, round 4 comment). Hidden when every extra slot is used. */}
      {!adding && freeSlot && (
        <div className="flex justify-center pt-6">
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setDraft({ q: '', a: '' })
              setAdding(true)
            }}
            className={buttonClass('ghost')}
          >
            <Icon name="plus" size={14} /> Add question
          </button>
        </div>
      )}
      {error && <p className="pt-3 text-center font-space text-[11px] text-accent-red">{error}</p>}
    </div>
  )
}
