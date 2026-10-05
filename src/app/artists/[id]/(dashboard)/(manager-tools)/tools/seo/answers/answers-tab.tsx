'use client'

import { useRef, useState, type FocusEvent } from 'react'
import Link from 'next/link'
import { FAQ_AUTO_ONLY, probePrompts } from '@samfox1/site-bridge/seo'
import { FAQ_EXTRA, FAQ_KEYS, FAQ_QUESTION_MAX } from '@/lib/site-content-schema'
import { cx } from '@/lib/cx'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { Icon } from '@/components/ui/icons'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { saveSeoFieldAction } from '../../../../actions'
import { useConfirm } from '../../../../confirm-dialog'
import { AddRow } from '../../../_ui/add-row'
import { LEDGER_ROW_GRID, LedgerRow, LedgerSection } from '../../../_ui/ledger'
import { RowIcon } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { FieldError } from '../../../_ui/field-error'
import { AreaField, EndSlot, LineField } from '../../../_ui/fields'

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
 * day after the show and the site ignores it; that source is a quiet line under the question.
 * Up to five questions of the manager's own sit under them ("Add question", the Brand lists'
 * AddRow, its + a size up: Sam, 2026-10-05).
 *
 * Every row is the ledger's (LedgerRow), centred like every other (Sam, 2026-10-02: "answers to
 * questions centered"); a question wraps.
 *
 * CLICK TO EDIT (Sam, 2026-10-05, prototypes/lists_before_after_20261002.html): at rest a row is
 * its question and its answer as text, no pencil and no trash. A click on the answer opens it
 * in place with ✓ beside it, and the row's own trash (your questions) or replay (a written
 * answer going back to the automatic one), which exist only while it is open. The answer
 * autosaves to the draft as it is written; ✓, Escape or a click away closes it. The layout's
 * Publish bar ships it.
 */
export function AnswersTab({ artistId, name, schemaType, initial, auto }: { artistId: string; name: string; schemaType: string; initial: Record<string, string>; auto: string[] }) {
  const [values, setValues] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = useDebouncedFieldSave<string>({
    persist: async (k, val) => {
      const r = await saveSeoFieldAction(artistId, k, val)
      setError(r.ok ? null : (r.error ?? SAVE_FAILED))
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
        setError(r.ok ? null : (r.error ?? SAVE_FAILED))
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
            onEdit={() => setEditing(r.key)}
            onDone={() => setEditing((e) => (e === r.key ? null : e))}
            onAnswer={(v) => set(r.key, v)}
            onQuestion={r.kind === 'extra' ? (v) => set(r.qKey, v) : undefined}
            onClear={() => void clear(r)}
          />
        ))}
        {freeSlot ? (
          // The question first (Enter or ✓), then its answer opens in place.
          <AddRow
            noun="question"
            label="New question"
            size="lg"
            placeholder="A question people ask"
            maxLength={FAQ_QUESTION_MAX}
            onAdd={(q) => {
              setNow([[freeSlot.q, q]])
              setEditing(freeSlot.a)
            }}
          />
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </LedgerSection>
      {dialog}
    </div>
  )
}

/** One question and its answer: a LedgerRow, or, while it is written, the same centred grid
 *  around its fields. */
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
    // The row's own actions exist only while it is open (Sam, 2026-10-05: the trash and the
    // replay show once a row is opened). Each closes the row first, then asks.
    const closeThenClear = () => {
      onDone()
      onClear()
    }
    const clearIcon =
      row.kind === 'extra' ? (
        <RowIcon icon="trash" label={`Remove: ${row.question}`} variant="bare" tone="danger" glyphSize={14} onClick={closeThenClear} />
      ) : row.written.trim() ? (
        <RowIcon icon="replay" label="Use the automatic answer" variant="bare" glyphSize={14} onClick={closeThenClear} />
      ) : null
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
        className={LEDGER_ROW_GRID}
      >
        {onQuestion ? (
          <LineField label="Question" value={row.question} onChange={onQuestion} className="w-full font-medium" />
        ) : (
          <div className="text-[15px] font-medium text-ink">{row.question}</div>
        )}
        <div className="flex min-w-0 items-center gap-2.5">
          <AnswerDraft label={`Answer: ${row.question}`} start={row.written || (row.kind === 'fixed' ? row.auto : '')} onAnswer={onAnswer} />
          {/* ✓ beside the field, not in the end column (prototypes/lists_before_after_20261002.html). */}
          <span className="inline-flex flex-none items-center gap-1.5">
            <RowIcon icon="check" label="Done" variant="bare" tone="accent" glyphSize={14} onClick={onDone} />
            {clearIcon}
          </span>
          <EndSlot />
        </div>
      </div>
    )
  }

  // At rest the answer is its text, and the text is the way in (no pencil, no trash).
  // An automatic-only answer's source is a quiet line UNDER its question, never beside the
  // answer (Sam, 2026-10-05: "be under the question or something. Some other spot"). The tag IS
  // the way there: the tool's own icon, no arrow (an arrow means "leaves Tapir" on these tabs).
  const source = from ? (
    <Link
      href={`/artists/${artistId}/${from.seg}`}
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded transition-colors hover:text-accent', FOCUS_RING)}
    >
      <Icon name={from.icon} size={12} aria-hidden="true" />
      {`comes from ${from.label}`}
    </Link>
  ) : undefined
  return (
    <LedgerRow title={row.question} wrap meta={source}>
      {from ? (
        // An automatic-only answer has no editor to open, so it is never cut short. `mr-auto`
        // keeps the answer at its column's left edge however wide the column grows.
        <span className={cx('mr-auto min-w-0 max-w-[60ch] flex-1 text-[14px] leading-[1.5]', answer ? 'text-ink-muted' : 'text-ink-faint')}>{answer || 'No answer yet'}</span>
      ) : (
        <button
          type="button"
          aria-label={`Edit: ${row.question}`}
          onClick={onEdit}
          className={cx(
            'mr-auto min-w-0 max-w-[60ch] flex-1 cursor-text rounded text-left text-[14px] leading-[1.5] transition-colors hover:text-ink',
            answer ? 'text-ink-muted' : 'text-ink-faint',
            FOCUS_RING,
          )}
        >
          <span className="line-clamp-3">{answer || 'No answer yet'}</span>
        </button>
      )}
    </LedgerRow>
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
