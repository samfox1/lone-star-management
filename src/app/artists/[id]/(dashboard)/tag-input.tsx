'use client'

import { useState, type KeyboardEvent } from 'react'
import { cx } from '@/lib/cx'
import { inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'

/**
 * A repeatable tag field: type a name, press Enter, get a chip. Backspace on an
 * empty box removes the last chip. Used for a tour date's supporting acts.
 *
 * COMMA IS NOT A SEPARATOR, deliberately — only Enter and blur commit a chip. That
 * is the entire reason this exists instead of one comma-split text input like a
 * song's featured artists (parseContributors): plenty of acts have a comma in the
 * name, and "Crosby, Stills & Nash" must be ONE act, not three.
 *
 * UNCONTROLLED, like a native `<input defaultValue onChange>`: it owns its chips and
 * only reports them. That suits both form mechanisms in the dashboard — SaveForm
 * posts a real <form>, while CreateModal builds FormData by hand from its own values
 * map — and it means the chips reset with the modal, since CardModal unmounts its
 * children when closed.
 *
 * Posts one hidden input PER TAG under `name`; the server reads them with getAll
 * (ARRAY_FIELDS in actions.ts). The leading blank sentinel is load-bearing: without
 * it, removing every chip would leave `name` absent from the FormData entirely,
 * extractUpdate would skip the field, and a cleared list could never be saved. The
 * server drops blanks, so the sentinel can never become a tag.
 */
export function TagInput({
  name,
  defaultValue = [],
  onChange,
  placeholder,
}: {
  name: string
  defaultValue?: string[]
  /** Notified after every add/remove, for callers that don't post a real form. */
  onChange?: (tags: string[]) => void
  placeholder?: string
}) {
  const [tags, setTags] = useState(defaultValue)
  const [draft, setDraft] = useState('')

  function update(next: string[]) {
    setTags(next)
    onChange?.(next)
  }

  function commit() {
    const tag = draft.trim()
    setDraft('')
    // Chips are deduped, which also makes the tag itself a safe React key.
    if (!tag || tags.includes(tag)) return
    update([...tags, tag])
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // This box sits inside a <form>: Enter must add a chip, not submit the form.
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      update(tags.slice(0, -1))
    }
  }

  return (
    <div className={cx(inputClass, 'flex flex-wrap items-center gap-1.5 py-1.5')}>
      <input type="hidden" name={name} value="" />
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface py-0.5 pl-2 pr-1 font-space text-xs"
        >
          <input type="hidden" name={name} value={tag} />
          {tag}
          <button
            type="button"
            onClick={() => update(tags.filter((t) => t !== tag))}
            aria-label={`Remove ${tag}`}
            className="text-ink-faint transition-colors hover:text-ink"
          >
            <Icon name="minus" size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={tags.length ? '' : placeholder}
        aria-label={placeholder ?? name}
        className="min-w-[7rem] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
      />
    </div>
  )
}

/**
 * CreateModal keeps every field value as a plain string, so tags ride there as
 * newline-joined text. A chip can never contain a newline (it comes from a
 * single-line input), which is what makes the round-trip lossless — and is why the
 * separator is a newline rather than the comma a tag may legitimately contain.
 */
export const joinTags = (tags: string[]): string => tags.join('\n')

export const splitTags = (raw: string): string[] =>
  raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
