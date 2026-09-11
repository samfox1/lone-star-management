'use client'

import { useState, type KeyboardEvent } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import type { SupportAct } from '@/lib/content'
import { setSupportActsAction } from '../actions'
import { toast } from '../toast'

/**
 * A tour date's lineup, edited one act at a time (Sam, 2026-09-11): each act is a name
 * and, optionally, its website. Rows can be edited in place or removed; a row at the
 * bottom adds the next one. It replaced the names-only chip field (TagInput) on the
 * date's modal — links used to live only in the editor's Links panel, a screen away.
 *
 * SELF-SAVING, like a song card's link inputs: every add / edit / remove sends the WHOLE
 * lineup through one action, optimistic first, reverted (with the server's message) if
 * refused. It sits inside the date's SaveForm, so Enter in the add row is caught here
 * — it adds an act and must never submit the form around it. Draft until Publish.
 */
export function SupportActs({
  artistId,
  tourDateId,
  acts: initial,
}: {
  artistId: string
  tourDateId: string
  acts: SupportAct[]
}) {
  const [acts, setActs] = useState(initial)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  /** Index of the row being edited, and its draft. */
  const [editing, setEditing] = useState<{ at: number; name: string; url: string } | null>(null)

  async function save(next: SupportAct[], done: string) {
    const prev = acts
    setActs(next) // optimistic
    const res = await setSupportActsAction(artistId, tourDateId, next)
    if (res.error) {
      setActs(prev)
      toast(res.error, 'error')
      return false
    }
    if (res.acts) setActs(res.acts) // as stored: trimmed, deduped, URLs normalised
    toast(done)
    return true
  }

  async function add() {
    const n = name.trim()
    if (!n) return
    const ok = await save([...acts, { name: n, url: url.trim() || null }], 'Act added')
    if (ok) {
      setName('')
      setUrl('')
    }
  }

  function remove(at: number) {
    void save(acts.filter((_, i) => i !== at), 'Act removed')
  }

  async function commitEdit() {
    if (!editing) return
    const n = editing.name.trim()
    if (!n) return
    const next = acts.map((a, i) => (i === editing.at ? { name: n, url: editing.url.trim() || null } : a))
    if (await save(next, 'Act saved')) setEditing(null)
  }

  // Enter commits the row it is in; the form around this component never sees it.
  const onEnter = (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    commit()
  }

  return (
    <div className="space-y-1.5">
      {acts.map((act, i) =>
        editing?.at === i ? (
          <div key={act.name} className="flex items-center gap-2">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={onEnter(commitEdit)}
              aria-label={`Name for ${act.name}`}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <input
              type="url"
              value={editing.url}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              onKeyDown={onEnter(commitEdit)}
              placeholder="Website"
              aria-label={`Website for ${act.name}`}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="button" onClick={commitEdit} aria-label="Save act" title="Save" className={iconButton}>
              <Icon name="check" size={14} />
            </button>
            <button type="button" onClick={() => setEditing(null)} aria-label="Cancel edit" title="Cancel" className={iconButton}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <div key={act.name} className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{act.name}</div>
              {act.url ? (
                <a
                  href={act.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-space text-[11px] text-ink-muted hover:text-ink"
                >
                  {hostOf(act.url)}
                </a>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setEditing({ at: i, name: act.name, url: act.url ?? '' })}
              aria-label={`Edit ${act.name}`}
              title="Edit"
              className={iconButton}
            >
              <Icon name="edit" size={14} />
            </button>
            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${act.name}`} title="Remove" className={iconButton}>
              <Icon name="minus" size={14} />
            </button>
          </div>
        ),
      )}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="Also performing…"
          aria-label="Act name"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="Website"
          aria-label="Website"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="button" onClick={add} aria-label="Add act" className={buttonClass('ghost')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  )
}

const iconButton =
  'flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink'

/** "arlo.example" for https://arlo.example/tour — the link, not the whole URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
