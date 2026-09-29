'use client'

import { useRef, useState, type FocusEvent } from 'react'
import Link from 'next/link'
import { FAQ_AUTO_ONLY, probePrompts } from '@samfox1/site-bridge/seo'
import { FAQ_EXTRA, FAQ_KEYS } from '@/lib/site-content-schema'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { saveSeoFieldAction } from '../../../../actions'
import { useConfirm } from '../../../../confirm-dialog'
import { LedgerSection } from '../../../_ui/ledger'
import { RowIcon } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { AreaField, EndSlot, FieldError, LineField } from '../_ui/parts'

/** Where an automatic-only answer comes from, and the tool that holds it. */
const FROM = {
  tour: { label: 'Tour', icon: 'tour', seg: 'tour' },
  music: { label: 'Music', icon: 'tracks', seg: 'music' },
} as const

type Row =
  | { kind: 'fixed'; key: string; question: string; written: string; auto: string; from?: keyof typeof FROM }
  | { kind: 'extra'; key: string; qKey: string; question: string; written: string }

/**
 * ANSWERS (round 2, prototypes/seo_variants_20260928_r2.html): the questions fans ask AI about
 * the artist, and the answers the site gives on its fact sheet.
 *
 * The five probe questions are fixed (their wording is the measurement). Their answers are
 * automatic until written; "Use the automatic answer" clears a written one. The next show and
 * the latest releases are AUTOMATIC ONLY (the bridge's FAQ_AUTO_ONLY): read-only rows that say
 * where the answer comes from, with the way to that tool, because a written one went stale the
 * day after the show and the site ignores it. Up to five questions of the manager's own sit
 * under them ("Add question").
 *
 * An answer edits in place and autosaves to the draft; the layout's Publish bar ships it.
 */
export function AnswersTab({ artistId, name, schemaType, initial, auto }: { artistId: string; name: string; schemaType: string; initial: Record<string, string>; auto: string[] }) {
  const [values, setValues] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useDebouncedFieldSave<string>({
    persist: async (k, val) => {
      const r = await saveSeoFieldAction(artistId, k, val)
      setError(r.ok ? null : (r.error ?? 'Couldn’t save that.'))
      return { ok: r.ok, error: r.error }
    },
  })
  const set = (k: string, val: string) => {
    setValues((v) => ({ ...v, [k]: val }))
    save.save(k, val)
  }
  /** Written at once (not debounced): a question added, a row cleared. */
  const setNow = (pairs: [string, string][]) => {
    setValues((v) => ({ ...v, ...Object.fromEntries(pairs) }))
    for (const [k, val] of pairs)
      save.runNow(k, async () => {
        const r = await saveSeoFieldAction(artistId, k, val)
        setError(r.ok ? null : (r.error ?? 'Couldn’t save that.'))
        return { ok: r.ok, error: r.error }
      })
  }

  // Both wipe the manager's own words, so both ask first (Sam, 2026-09-28: "are you sure" on
  // deletes and reverts).
  const { ask, dialog } = useConfirm()
  const clear = async (r: Row) => {
    const ok =
      r.kind === 'extra'
        ? await ask(`Remove “${r.question.trim()}” and its answer?`, { action: 'Remove' })
        : await ask('Replace your answer with the automatic one? Your words will be deleted.', { action: 'Use automatic' })
    if (ok) setNow(r.kind === 'extra' ? [[r.qKey, ''], [r.key, '']] : [[r.key, '']])
  }

  const prompts = probePrompts(name, schemaType)
  const rows: Row[] = [
    ...prompts.map((question, i): Row => {
      const from = FAQ_AUTO_ONLY[i + 1]
      // An automatic-only row never shows a stored written answer: the site ignores it.
      return { kind: 'fixed', key: FAQ_KEYS[i], question, written: from ? '' : (values[FAQ_KEYS[i]] ?? ''), auto: auto[i] ?? '', from }
    }),
    // A question being edited keeps its row even while its text is emptied.
    ...FAQ_EXTRA.filter((e) => (values[e.q] ?? '').trim() || editing === e.a).map((e): Row => ({ kind: 'extra', key: e.a, qKey: e.q, question: values[e.q] ?? '', written: values[e.a] ?? '' })),
  ]
  const freeSlot = FAQ_EXTRA.find((e) => !(values[e.q] ?? '').trim() && editing !== e.a)

  return (
    <div>
      <LedgerSection label="Answers">
        {rows.map((r) => (
          <AnswerRow
            key={r.key}
            artistId={artistId}
            row={r}
            editing={editing === r.key}
            onEdit={() => {
              setAdding(false)
              setEditing(r.key)
            }}
            onDone={() => setEditing((e) => (e === r.key ? null : e))}
            onAnswer={(v) => set(r.key, v)}
            onQuestion={r.kind === 'extra' ? (v) => set(r.qKey, v) : undefined}
            onClear={() => void clear(r)}
          />
        ))}
        {adding && freeSlot ? (
          <AddQuestion
            onAdd={(q) => {
              setNow([[freeSlot.q, q]])
              setAdding(false)
              setEditing(freeSlot.a)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : freeSlot ? (
          <div className="pt-2.5">
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setAdding(true)
              }}
              className={cx('inline-flex w-max items-center gap-2 py-1.5 text-[14px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-offset-2', FOCUS_RING)}
            >
              <Icon name="plus" size={16} />
              Add question
            </button>
          </div>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </LedgerSection>
      {dialog}
    </div>
  )
}

/** The row grammar of the ledger (ledger.tsx LedgerRow), with a question that wraps. */
const ROW = 'group/ledger grid grid-cols-1 gap-6 border-b border-hairline-soft py-4 last:border-b-0 min-[900px]:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)]'

function AnswerRow({
  artistId,
  row,
  editing,
  onEdit,
  onDone,
  onAnswer,
  onQuestion,
  onClear,
}: {
  artistId: string
  row: Row
  editing: boolean
  onEdit: () => void
  onDone: () => void
  onAnswer: (v: string) => void
  onQuestion?: (v: string) => void
  onClear: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const answer = row.written.trim() || (row.kind === 'fixed' ? row.auto : '')
  const from = row.kind === 'fixed' && row.from ? FROM[row.from] : null
  // Leaving the row (focus moves outside it) ends the edit; the words are already saved.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!box.current?.contains(e.relatedTarget as Node | null)) onDone()
  }

  if (editing && !from) {
    return (
      <div
        ref={box}
        data-answer-row={row.key}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
          }
        }}
        className={cx(ROW, 'items-start')}
      >
        {onQuestion ? (
          <LineField label="Question" value={row.question} onChange={onQuestion} className="w-full font-medium" />
        ) : (
          <div className="text-[15px] font-medium text-ink">{row.question}</div>
        )}
        <div className="flex min-w-0 items-start gap-2.5">
          <AnswerDraft label={`Answer: ${row.question}`} start={row.written || (row.kind === 'fixed' ? row.auto : '')} onAnswer={onAnswer} />
          <EndSlot>
            <RowIcon icon="check" label="Done" variant="primary" tone="accent" onClick={onDone} />
          </EndSlot>
        </div>
      </div>
    )
  }

  return (
    <div data-answer-row={row.key} className={cx(ROW, 'items-start')}>
      <div className="text-[15px] font-medium text-ink">{row.question}</div>
      <div className="flex min-w-0 items-start gap-2.5">
        {/* An automatic-only answer has no editor to open, so it is never cut short. */}
        <span className={cx('min-w-0 max-w-[60ch] flex-1 text-[14px] leading-[1.5]', !from && 'line-clamp-3', answer ? 'text-ink-muted' : 'text-ink-faint')}>{answer || 'No answer yet'}</span>
        {from ? (
          <>
            {/* r2's tag, and the tag IS the way there: the tool's own icon, no arrow (an arrow
                means "leaves Tapir" elsewhere on these tabs). */}
            <Link
              href={`/artists/${artistId}/${from.seg}`}
              className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded pt-[3px] font-space text-[12px] text-ink-faint transition-colors hover:text-accent', FOCUS_RING)}
            >
              <Icon name={from.icon} size={14} aria-hidden="true" />
              {`comes from ${from.label}`}
            </Link>
            <EndSlot />
          </>
        ) : (
          <>
            {row.written.trim() ? (
              <RowIcon
                icon={row.kind === 'extra' ? 'trash' : 'replay'}
                label={row.kind === 'extra' ? `Remove: ${row.question}` : 'Use the automatic answer'}
                tone={row.kind === 'extra' ? 'danger' : 'default'}
                onClick={onClear}
              />
            ) : row.kind === 'extra' ? (
              <RowIcon icon="trash" label={`Remove: ${row.question}`} tone="danger" onClick={onClear} />
            ) : null}
            <EndSlot>
              <RowIcon icon="edit" label={`Edit: ${row.question}`} onClick={onEdit} />
            </EndSlot>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The answer being written. Opens holding the written answer, or the automatic one to start
 * from; only a real change is saved, so opening and leaving writes nothing. Emptied, it saves
 * blank, which is "use the automatic answer" again.
 */
function AnswerDraft({ label, start, onAnswer }: { label: string; start: string; onAnswer: (v: string) => void }) {
  const [draft, setDraft] = useState(start)
  return (
    <AreaField
      label={label}
      value={draft}
      placeholder="The answer"
      small
      rows={3}
      autoFocus
      onChange={(v) => {
        setDraft(v)
        onAnswer(v)
      }}
      className="w-full max-w-[60ch] flex-1"
    />
  )
}

/** "Add question": the question first (Enter or ✓), then its answer opens in place. */
function AddQuestion({ onAdd, onCancel }: { onAdd: (q: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('')
  const done = useRef(false)
  const confirm = () => {
    const v = q.trim()
    if (!v || done.current) return
    done.current = true
    onAdd(v)
  }
  return (
    <div className="flex items-center gap-2 pt-2.5">
      <input
        autoFocus
        aria-label="New question"
        value={q}
        placeholder="A question people ask"
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="w-[320px] max-w-full rounded-lg border border-hairline bg-paper px-2.5 py-[7px] text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-ink"
      />
      <RowIcon icon="check" label="Add" variant="boxed" size="sm" tone="accent" onClick={confirm} />
      <RowIcon icon="close" label="Cancel" variant="boxed" size="sm" tone="danger" onClick={onCancel} />
    </div>
  )
}
