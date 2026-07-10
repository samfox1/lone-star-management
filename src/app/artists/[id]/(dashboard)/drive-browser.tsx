'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { sizeLabel } from '@/lib/upload'
import type { DriveFile, DriveKind } from '@/lib/drive'
import { useDriveModalBusy } from './drive-import-button'
import { toast } from './toast'

export type DriveListResult =
  | { ok: true; files: DriveFile[]; nextPageToken: string | null; imported: string[] }
  | { ok: false; error: string }

type RowStatus = 'importing' | 'done' | { error: string }

const NOUN: Record<DriveKind, string> = { audio: 'song', image: 'image', video: 'video' }

/**
 * Browse the artist's connected Drive folder (one media kind) and copy-import a
 * selection. Browsing is free — names/sizes/thumbnails stream from Drive; Import
 * downloads each file server-side into our buckets. Imports run SEQUENTIALLY on
 * purpose: the server buffers one file at a time. Already-imported files (by
 * drive_file_id) are badged and unselectable.
 */
export function DriveBrowser({
  kind,
  listAction,
  importAction,
}: {
  kind: DriveKind
  listAction: (pageToken?: string | null) => Promise<DriveListResult>
  importAction: (fileId: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const router = useRouter()
  const [files, setFiles] = useState<DriveFile[]>([])
  const [imported, setImported] = useState<Set<string>>(new Set())
  const [nextToken, setNextToken] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Map<string, RowStatus>>(new Map())
  const [busy, setBusy] = useState(false)

  // Tell the enclosing DriveImportButton shell we're mid-import so Escape / an
  // overlay click can't unmount us and orphan the in-flight downloads.
  useDriveModalBusy(busy)

  // No synchronous setState here: `loading` starts true and flips only after the
  // fetch settles, so the mount effect stays cascade-free (react-hooks lint).
  async function load(pageToken?: string | null) {
    try {
      const res = await listAction(pageToken)
      if (!res.ok) {
        setListError(res.error)
        return
      }
      setFiles((prev) => (pageToken ? [...prev, ...res.files] : res.files))
      setImported(new Set(res.imported))
      setNextToken(res.nextPageToken)
    } catch {
      setListError("Couldn't reach Google Drive. Try again.")
    } finally {
      setLoading(false)
    }
  }

  function loadMore(pageToken: string) {
    setLoading(true) // event handler — sync setState is fine here
    void load(pageToken)
  }

  // The browser mounts only when its panel/modal opens, so this is one on-open
  // fetch; every setState in load() sits AFTER the await (the sync-setState rule
  // can't see through the call and false-positives here).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function importSelected() {
    if (busy || selected.size === 0) return
    setBusy(true)
    const ids = files.filter((f) => selected.has(f.id)).map((f) => f.id) // list order
    let okCount = 0
    try {
      for (const id of ids) {
        setStatus((m) => new Map(m).set(id, 'importing'))
        let res: { ok: boolean; error?: string }
        try {
          res = await importAction(id)
        } catch {
          res = { ok: false, error: 'Import failed.' }
        }
        if (res.ok) {
          okCount++
          setStatus((m) => new Map(m).set(id, 'done'))
          setImported((s) => new Set(s).add(id))
          setSelected((s) => {
            const next = new Set(s)
            next.delete(id)
            return next
          })
        } else {
          setStatus((m) => new Map(m).set(id, { error: res.error ?? 'Import failed.' }))
        }
      }
      const failed = ids.length - okCount
      if (failed === 0) toast(`Imported ${okCount} ${NOUN[kind]}${okCount === 1 ? '' : 's'}`)
      else toast(`Imported ${okCount} of ${ids.length} — ${failed} failed`, 'error')
      if (okCount > 0) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (listError) {
    return <p className="font-space text-xs text-accent-red">{listError}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
          Google Drive · {NOUN[kind]}s
        </span>
        <button
          type="button"
          onClick={importSelected}
          disabled={busy || selected.size === 0}
          className={buttonClass('solid')}
        >
          {busy ? 'Importing…' : `Import ${selected.size || ''} ${NOUN[kind]}${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>

      {loading && files.length === 0 ? (
        <p className="font-space text-xs text-ink-faint">Loading your Drive folder…</p>
      ) : files.length === 0 ? (
        <p className="font-space text-xs text-ink-faint">No {NOUN[kind]} files in the connected folder.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-auto">
          {files.map((f) => {
            const st = status.get(f.id)
            const done = imported.has(f.id)
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-lg border border-hairline p-2">
                <input
                  type="checkbox"
                  aria-label={f.name}
                  checked={selected.has(f.id)}
                  disabled={done || busy}
                  onChange={() => toggle(f.id)}
                  className="h-4 w-4 flex-none accent-black"
                />
                <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-md bg-surface text-ink-faint">
                  {f.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  ) : (
                    <Icon name="tracks" size={16} />
                  )}
                </span>
                <span className={cx('min-w-0 flex-1 truncate text-sm', done && 'text-ink-faint')}>{f.name}</span>
                {f.size != null && (
                  <span className="flex-none font-space text-[11px] tabular-nums text-ink-faint">
                    {sizeLabel(f.size)}
                  </span>
                )}
                {done ? (
                  <span className="flex-none font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                    Imported
                  </span>
                ) : st === 'importing' ? (
                  <span className="flex-none font-space text-[11px] text-ink-muted">Importing…</span>
                ) : st && typeof st === 'object' ? (
                  <span className="max-w-[45%] flex-none truncate font-space text-[11px] text-accent-red" title={st.error}>
                    {st.error}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {nextToken && (
        <button type="button" onClick={() => loadMore(nextToken)} disabled={loading} className={buttonClass('ghost')}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
