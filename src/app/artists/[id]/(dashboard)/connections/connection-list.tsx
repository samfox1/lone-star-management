'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass } from '@/components/ui/ui'
import type { ConnectionRow } from '@/lib/connections'
import { publishEntityAction, setOnSiteAction, updateContentAction, saveSourceIdAction } from '../actions'
import { useConfirm } from '../confirm-dialog'
import { PublishBar } from '../publish-bar'
import { SelectToggle } from '../select-toggle'
import { toast } from '../toast'
import { ConnectModal } from './connect-modal'
import { ConnectionMark } from './connection-mark'
import { disconnectConnectionAction, pullConnectionAction, syncProfileAction } from './actions'

/**
 * THE CONNECTIONS LIST (Sam, 2026-09-13): "one organized list with all of the current
 * platform accounts hooked up". One row per platform — ring, mark, name, handle, and on
 * the right what it pulls in. No headings: the rail names the tool.
 *
 * Rows follow the tour list: no hairlines, the rhythm is the rows' own spacing, the
 * handle truncates before it can touch the chip beside it, and the ⋯ sits at the end.
 *
 * Links flip on and off the site INSTANTLY (LIVE_TOGGLE, lib/content.ts), so the ring
 * is ink or empty — never the blue/red pending states the publish-gated grids wear.
 */
export function ConnectionList({ artistId, rows: initial, dirty = false }: { artistId: string; rows: ConnectionRow[]; dirty?: boolean }) {
  const router = useRouter()
  // Seeded from the server's rows and RE-SEEDED when they change (a refresh after a
  // connect), so an optimistic row can't outlive the truth. Render-phase, not an effect —
  // the modal kit's rule, and the lint rule's.
  const [state, setState] = useState({ from: initial, rows: initial })
  if (state.from !== initial) setState({ from: initial, rows: initial })
  const rows = state.rows
  const setRows = (fn: (rows: ConnectionRow[]) => ConnectionRow[]) => setState((s) => ({ ...s, rows: fn(s.rows) }))
  const [connect, setConnect] = useState(false)

  async function publish(password: string) {
    // Snapshot only — links are already live or not by their ring; publish pushes edits.
    const res = await publishEntityAction('link', artistId, password)
    if (res.ok) router.refresh()
    return res
  }

  return (
    // The tour list's width (Sam, 2026-09-13: "these rows can be less wide"), and room
    // at the bottom for the floating Publish.
    <div className="mx-auto max-w-3xl pb-24">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => setConnect(true)} className={buttonClass('solid')}>
          <Icon name="plus" size={12} /> Connect
        </button>
      </div>

      <div className="mt-6">
        {rows.map((r) => (
          <ConnectionRowView
            key={r.key}
            artistId={artistId}
            row={r}
            onChange={(next) => setRows((all) => (next ? all.map((x) => (x.key === r.key ? next : x)) : all.filter((x) => x.key !== r.key)))}
          />
        ))}
      </div>

      {connect && (
        <ConnectModal
          artistId={artistId}
          taken={rows.map((r) => r.key)}
          onClose={() => setConnect(false)}
          onDone={() => router.refresh()}
        />
      )}

      <PublishBar pendingCount={0} dirty={dirty} onPublish={publish} noun="connections" />
    </div>
  )
}

/** "instagram.com/skeen" from "https://www.instagram.com/skeen/" — the handle a manager
 *  recognises, not the whole address. Editing shows the full URL. */
export function handleOf(url: string): string {
  return url
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

function ConnectionRowView({ artistId, row, onChange }: { artistId: string; row: ConnectionRow; onChange: (next: ConnectionRow | null) => void }) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const value = row.url ?? row.sourceId ?? ''
  const shown = row.url ? handleOf(row.url) : value

  async function toggle() {
    if (!row.linkId) return
    const next = !row.onSite
    onChange({ ...row, onSite: next }) // optimistic
    const res = await setOnSiteAction('link', row.linkId, artistId, next)
    if (res?.error) {
      onChange(row)
      toast(res.error, 'error')
    }
  }

  async function save(next: string) {
    setEditing(false)
    if (next === value) return
    const prev = row
    if (row.linkId) {
      onChange({ ...row, url: next })
      const fd = new FormData()
      fd.set('url', next)
      const res = await updateContentAction('link', row.linkId, artistId, fd)
      if (res?.error) {
        onChange(prev)
        toast(res.error, 'error')
      }
    } else if (row.def.source?.idField) {
      onChange({ ...row, sourceId: next })
      const res = await saveSourceIdAction(artistId, row.def.source.idField, next)
      if (res?.error) {
        onChange(prev)
        toast(res.error, 'error')
      }
    }
  }

  /** The first pull for a profile that is on the page but never synced — the id comes
   *  out of the link, nothing is typed. After it, the chip reads synced (or says why not). */
  async function sync() {
    setMenuOpen(false)
    setPulling(true)
    const res = await syncProfileAction(artistId, row.key)
    setPulling(false)
    if (res.ok) {
      toast(res.message ?? `${row.label} synced`)
      router.refresh()
    } else toast(res.error ?? `${row.label} didn’t sync.`, 'error')
  }

  async function pull() {
    setMenuOpen(false)
    setPulling(true)
    const res = await pullConnectionAction(artistId, row.key)
    setPulling(false)
    if (res.ok) {
      toast(res.message ?? `${row.label}: pulled`)
      router.refresh()
    } else toast(res.error ?? `${row.label} didn’t answer.`, 'error')
  }

  async function remove() {
    setMenuOpen(false)
    if (!(await ask(`Remove ${row.label}? Its link comes off the site and nothing more is pulled from it.`, { action: 'Remove' }))) return
    const res = await disconnectConnectionAction(artistId, row.key, row.linkId)
    if (res?.error) return toast(res.error, 'error')
    onChange(null)
    toast(`${row.label} removed`)
  }

  const dim = row.linkId ? !row.onSite : false

  return (
    <div className="group flex items-center gap-4 py-3">
      {row.linkId ? (
        <SelectToggle selected={row.onSite} onSite={row.onSite} onToggle={toggle} label={row.label} className="rounded-full" />
      ) : (
        <span className="h-5 w-5 flex-none" aria-hidden />
      )}
      <span className={cx('flex w-5 flex-none justify-center', dim ? 'text-ink-faint' : 'text-ink')}>
        <ConnectionMark def={row.def} size={16} />
      </span>
      <span className={cx('w-28 flex-none truncate text-sm font-semibold', dim && 'text-ink-faint')}>{row.label}</span>

      <HandleField
        label={`${row.label} ${row.linkId ? 'link' : 'id'}`}
        value={value}
        shown={shown}
        editing={editing}
        onEdit={() => setEditing(true)}
        onCancel={() => setEditing(false)}
        onSave={save}
      />

      <span className="flex w-40 flex-none items-center justify-end">
        {/* Just the word (Sam, 2026-09-13: "It either says synced or connect"). */}
        {row.state === 'synced' && (
          <span className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-ink-muted">
            <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} />
            synced
          </span>
        )}
        {row.state === 'failed' && (
          <span className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-accent-red">
            <Icon name="alert" size={11} />
            Couldn’t connect ·
            <button type="button" onClick={pull} disabled={pulling} className="text-ink hover:text-accent disabled:opacity-50">
              {pulling ? 'Retrying…' : 'Retry'}
            </button>
          </span>
        )}
        {/* Not "Connect" — the check already says it is (Sam, 2026-09-13). The account is
            here; its catalog has never been pulled. */}
        {row.state === 'connect' && (
          <button type="button" onClick={sync} disabled={pulling} aria-label={`Sync ${row.label}`} className="inline-flex items-center gap-1.5 font-space text-[10.5px] text-ink-faint hover:text-ink disabled:opacity-50">
            <Icon name="refresh" size={11} className={cx(pulling && 'animate-spin')} /> {pulling ? 'Syncing…' : 'Sync'}
          </button>
        )}
      </span>

      <div ref={menuRef} className="relative flex-none">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`${row.label} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="more" size={18} />
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-xl border border-hairline bg-paper py-1 shadow-2xl">
            <MenuItem icon="edit" onClick={() => { setMenuOpen(false); setEditing(true) }}>Edit</MenuItem>
            {row.url && (
              <a role="menuitem" href={row.url} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface">
                <Icon name="external" size={15} /> Open
              </a>
            )}
            {row.def.source && (row.state === 'connect' ? <MenuItem icon="refresh" onClick={sync}>Sync</MenuItem> : <MenuItem icon="refresh" onClick={pull}>Pull now</MenuItem>)}
            <MenuItem icon="trash" onClick={remove} danger>Remove</MenuItem>
          </div>
        )}
      </div>
      {dialog}
    </div>
  )
}

function MenuItem({ icon, onClick, danger, children }: { icon: 'edit' | 'refresh' | 'trash'; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', danger ? 'text-accent-red hover:bg-danger-soft' : 'hover:bg-surface')}
    >
      <Icon name={icon} size={15} /> {children}
    </button>
  )
}

/**
 * The handle: text until clicked, then an input holding the FULL value, saved on blur or
 * Enter, put back on Escape. Text and input share one 24px box so the row never moves —
 * the modal kit's rule, applied to a list row.
 */
function HandleField({
  label,
  value,
  shown,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  label: string
  value: string
  shown: string
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (next: string) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  // The draft is seeded the moment editing STARTS, from the value at that moment.
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    if (editing) setDraft(value)
  }

  const box = 'block h-6 min-w-0 flex-1 truncate border-b font-space text-[13px] leading-6'
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void onSave(draft.trim())}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void onSave(draft.trim())
          } else if (e.key === 'Escape') onCancel()
        }}
        className={cx(box, 'border-ink bg-transparent p-0 text-ink outline-none')}
      />
    )
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      className={cx(box, 'cursor-text border-transparent text-ink-muted group-hover:text-ink', !shown && 'text-hairline')}
    >
      {shown || '—'}
    </span>
  )
}
