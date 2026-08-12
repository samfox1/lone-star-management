import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type ManifestLinkRegion } from '@/lib/site-editor/manifest'
import { safeHref } from '@/lib/url'
import { type EditorLink } from '../inspector-types'
import { useScrollIntoFocus } from '../inspector-grid'
import {
  runSerialized,
  FieldRow,
  EditRow,
  SaveLine,
  OnSiteToggle,
  EYEBROW,
  INVALID_FIELD,
  FIELD,
  FIELD_ON_TINT,
  PANEL_BODY,
  type SaveStatus,
} from '../inspector-shared'
import { addContentAction, saveEditorLinkAction, updateContentAction } from '../../actions'
import { AddSocialModal } from '../add-social-modal'

/* ── Site-link tools: set the href for each manifest-declared link button ────────────
 * Mirrors StyleTools (manifest-driven, Phase 2): the site declares its link-powered
 * elements (USB / Merch buttons) in its manifest; here the manager sets each one's URL
 * BY KEY. An unset link shows as an EMPTY, labelled row, so a missing one (e.g. USB) is
 * visible rather than invisible. Saving writes a `links` row keyed by role and posts
 * `apply-link` so the frame updates live. Selecting the element in the frame focuses its
 * row. Socials are a SEPARATE panel — these are only the declared buttons. */
export function SiteLinkTools({
  regions,
  values,
  selected,
  artistId,
  onApplyLink,
}: {
  regions: ManifestLinkRegion[]
  values: Record<string, string>
  selected: string | null
  artistId: string
  onApplyLink?: (key: string, url: string) => void
}) {
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? ''])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const fieldRefs = useRef<Map<string, HTMLInputElement | null>>(new Map())
  // Manifest labels, so the unmount flush can name each row without the region list
  // being an effect dependency (same trick as SupportLinkTools' linksRef).
  const labelsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    labelsRef.current = Object.fromEntries(regions.map((r) => [r.key, r.label]))
  }, [regions])

  // The frame's manifest arrives on `ready`, so regions/values can land after first
  // render — re-seed when they do, without clobbering typing.
  const seedKey = regions.map((r) => r.key).join(',')
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setText(Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? ''])))
  }

  // Which button's inline URL box is revealed. A button's URL is PLAIN TEXT until its
  // pencil is pressed (Sam, 2026-08-12: "the link shouldn't appear editable until the
  // edit button is pressed") — then a box drops below the row. One open at a time.
  const [openKey, setOpenKey] = useState<string | null>(null)

  // A click on the button IN THE FRAME opens its row. Reset-on-prop-change DURING render
  // (the repo's sanctioned pattern), not in an effect — an effect setState cascades a
  // render and the lint rule rightly rejects it. The scroll/focus is a real side effect,
  // so it stays in the effect below, keyed off the now-open row.
  const [lastSelected, setLastSelected] = useState<string | null>(null)
  if (selected && selected !== lastSelected) {
    setLastSelected(selected)
    setOpenKey(selected)
  }
  useEffect(() => {
    if (!selected) return
    const el = fieldRefs.current.get(selected)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [selected])

  const persist = useCallback(
    (key: string, url: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () =>
        saveEditorLinkAction(artistId, key, url, labelsRef.current[key] ?? key),
      )
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((url, key) => {
        void saveEditorLinkAction(artistId, key, url, labelsRef.current[key] ?? key)
      })
    }
  }, [artistId])

  function edit(key: string, raw: string) {
    setText((t) => ({ ...t, [key]: raw }))
    const trimmed = raw.trim()
    // Blank clears the link (valid). A non-blank value must be a safe http(s)/relative
    // URL — validated with the SAME safeHref the action uses, so the panel can't claim
    // "Saved" on a write the server will reject.
    const ok = trimmed === '' || safeHref(trimmed) !== undefined
    setInvalid((s) => {
      const next = new Set(s)
      if (ok) next.delete(key)
      else next.add(key)
      return next
    })
    if (!ok) return

    onApplyLink?.(key, trimmed) // optimistic href in the frame
    pending.current.set(key, trimmed)
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        persist(key, trimmed)
      }, 500),
    )
  }

  if (!regions.length) {
    return (
      <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
        This site hasn&apos;t declared any link buttons. A custom site sends them when the
        preview loads; the built-in templates declare none yet.
      </p>
    )
  }

  return (
    <div className="pb-2 pt-1">
      {regions.map((r) => {
        const url = text[r.key] ?? ''
        const isOpen = openKey === r.key
        return (
          <div key={r.key}>
            {/* The URL is plain text until the pencil opens the box (no "lit" editable
                link, no bolt icon). The site's `description` rides the row's hover title
                and the box's accessible description, so it never costs a row. */}
            <div title={r.description}>
              <EditRow
                label={r.label}
                value={url || 'Add a link'}
                empty={!url}
                onEdit={() => setOpenKey(isOpen ? null : r.key)}
              />
            </div>
            {isOpen && (
              <div className="px-4 pb-3">
                <input
                  autoFocus
                  aria-describedby={r.description ? `link-desc-${r.key}` : undefined}
                  ref={(el) => {
                    fieldRefs.current.set(r.key, el)
                  }}
                  aria-label={`${r.label} URL`}
                  aria-invalid={invalid.has(r.key) || undefined}
                  type="url"
                  value={url}
                  onChange={(e) => edit(r.key, e.target.value)}
                  placeholder="https://…  (blank = no link)"
                  className={cx(FIELD, invalid.has(r.key) && INVALID_FIELD)}
                />
                {r.description && (
                  <span id={`link-desc-${r.key}`} className="sr-only">
                    {r.description}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
      <SaveLine status={status} />
    </div>
  )
}
/* ── Link tools: edit / reorder / remove the site's outbound links ───────────── */
/** A link row that shows WHERE a frame click landed: scrolls into view and carries
 *  aria-current when it is the focused region. A plain div otherwise — every drag
 *  handler and class passes straight through. */
function FocusScroll({
  focused,
  children,
  ...rest
}: { focused: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & {
  draggable?: boolean
}) {
  const ref = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div ref={ref} aria-current={focused ? 'true' : undefined} {...rest}>
      {children}
    </div>
  )
}

export function LinkTools({
  links,
  artistId,
  onRemove,
  onReorder,
  onToggleOnSite,
  group,
  showAdd = true,
  focusedKey,
}: {
  links: EditorLink[]
  artistId: string
  onRemove: (l: EditorLink) => void
  onReorder: (fromId: string, toId: string) => void
  /** Names this list in the accessible labels. The panel renders LinkTools TWICE
   *  (Socials and Contact) and row labels used to be numbered per-list, so
   *  "Link 1 label" existed twice in the DOM — ambiguous to a screen reader and to
   *  getByLabelText. The group disambiguates them. */
  group: string
  /** The "Add link" footer. Off for the Contact group, which is a slice of the same
   *  list — one add affordance per panel, not one per group. */
  showAdd?: boolean
  onToggleOnSite: (l: EditorLink) => void
  /** The selected region's stable key. A social icon in the frame posts
   *  `item:link:<label lowercased>` — the LABEL, because the row id never reaches the
   *  deployed site (socials arrive there as label-mapped config values), and lowercasing
   *  is the exact normalization that pipeline already joins on. */
  focusedKey?: string | null
}) {
  const [values, setValues] = useState<Record<string, { label: string; url: string }>>(() =>
    Object.fromEntries(links.map((l) => [l.id, { label: l.label, url: l.url }])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [adding, setAdding] = useState(false)
  const router = useRouter()
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  // Which row is expanded. Rows collapse to just their label; clicking one opens the
  // edit/remove controls below it (single-open accordion — keeps the list short).
  const [open, setOpen] = useState<string | null>(null)

  // A social selected in the FRAME lands as `item:link:<label lowercased>` — join by the
  // same normalization and OPEN that row, or the "selected link" is a closed accordion
  // line indistinguishable from its neighbours. Render-time reset on prop change (the
  // repo's selectedStyle pattern), so the manager's own accordion clicks still win after.
  const focusedLabel = focusedKey?.startsWith('item:link:') ? focusedKey.slice('item:link:'.length) : null
  const focusedRow = focusedLabel != null ? links.find((l) => l.label.trim().toLowerCase() === focusedLabel) : undefined
  const [lastFocusedLabel, setLastFocusedLabel] = useState<string | null>(null)
  if (focusedLabel !== lastFocusedLabel) {
    setLastFocusedLabel(focusedLabel)
    if (focusedRow) setOpen(focusedRow.id)
  }
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // Latest values, so the unmount flush reads current text (synced off-render).
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const persist = useCallback(
    (id: string, v: { label: string; url: string }) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('label', v.label)
      fd.set('url', v.url)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('link', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const v = valuesRef.current[id]
        if (!v) return
        const fd = new FormData()
        fd.set('label', v.label)
        fd.set('url', v.url)
        void updateContentAction('link', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, patch: Partial<{ label: string; url: string }>) {
    const row = { ...(values[id] ?? { label: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const ok = row.label.trim() !== '' && row.url.trim() !== '' // both required — a blank one is dropped
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id)
      return
    }
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, row)
      }, 500),
    )
  }

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(links[from].id, links[to].id)
  }

  return (
    <div className="pb-2 pt-1">
      {links.map((l, i) => {
        const v = values[l.id] ?? { label: l.label, url: l.url }
        const isOpen = open === l.id
        const labelBlank = !v.label.trim()
        const urlBlank = !v.url.trim()
        const rowInvalid = invalid.has(l.id)
        const isFocused = focusedRow?.id === l.id
        return (
          <FocusScroll
            key={l.id}
            focused={isFocused}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragEnter={() => setDragOver(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
            onDragEnd={() => {
              dragFrom.current = null
              setDragOver(null)
            }}
            className={cx(
              (dragOver === i || isFocused) && 'ring-2 ring-accent',
              rowInvalid && 'ring-1 ring-accent-red',
            )}
          >
            {/* Collapsed header — the whole row is a button that opens the editor below
                it. Only the label shows (what the manager named it); an at-a-glance
                "Off" tag flags a link that isn't on the site. The grip sits INSIDE the
                row (no border to hang it off), so drag-to-reorder stays discoverable. */}
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : l.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left hover:bg-surface-hover"
            >
              <span className="flex-none cursor-grab text-ink-faint" aria-hidden>
                <Icon name="grip" size={16} />
              </span>
              <span className={cx('min-w-0 flex-1 truncate text-[13px]', labelBlank ? 'text-ink-faint' : 'text-ink')}>
                {v.label.trim() || 'Untitled link'}
              </span>
              {!l.onSite && <span className={cx(EYEBROW, 'flex-none')}>Off</span>}
              <span
                className={cx('flex-none text-ink-faint transition-transform', isOpen && 'rotate-90')}
                aria-hidden
              >
                <Icon name="chevronRight" size={16} />
              </span>
            </button>

            {isOpen && (
              <div className={PANEL_BODY}>
                <FieldRow icon="text" label="Label">
                  <input
                    aria-label={`${group} link ${i + 1} label`}
                    aria-invalid={(rowInvalid && labelBlank) || undefined}
                    value={v.label}
                    onChange={(e) => edit(l.id, { label: e.target.value })}
                    placeholder="Label"
                    className={cx(FIELD_ON_TINT, rowInvalid && labelBlank && INVALID_FIELD)}
                  />
                </FieldRow>
                <FieldRow icon="links" label="URL">
                  <input
                    aria-label={`${group} link ${i + 1} URL`}
                    aria-invalid={(rowInvalid && urlBlank) || undefined}
                    type="url"
                    value={v.url}
                    onChange={(e) => edit(l.id, { url: e.target.value })}
                    placeholder="https://…"
                    className={cx(FIELD_ON_TINT, rowInvalid && urlBlank && INVALID_FIELD)}
                  />
                </FieldRow>
                <div className="grid grid-cols-[20px_1fr_auto] items-center gap-x-2.5 pt-2">
                  <span className="justify-self-center text-ink-faint" aria-hidden>
                    <Icon name="site" size={14} />
                  </span>
                  {/* justify-self-start: the grid's 1fr column would otherwise stretch
                      the pill across the whole row. */}
                  <OnSiteToggle on={l.onSite} onToggle={() => onToggleOnSite(l)} className="justify-self-start" />
                  <button
                    type="button"
                    aria-label={`Remove ${group.toLowerCase()} link ${i + 1}`}
                    onClick={() => onRemove(l)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
                  >
                    <Icon name="trash" size={15} />
                    <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Remove</span>
                  </button>
                </div>
              </div>
            )}
          </FocusScroll>
        )
      })}

      {showAdd && (
        // A BUTTON, not a link out. The old footer navigated to /artists/[id]/links,
        // which threw away the whole editor session — frame, scroll, open panel — to
        // type one URL (Sam, 2026-08-09). The new row joins THIS list, so it lands in
        // the site's socials container and the row re-centres itself.
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left text-accent hover:bg-surface-hover"
        >
          <Icon name="plus" size={16} />
          <span className="text-[13px]">Add social</span>
        </button>
      )}

      {adding && (
        <AddSocialModal
          existingLabels={links.map((l) => l.label)}
          onCancel={() => setAdding(false)}
          onAdd={async (label, url) => {
            const fd = new FormData()
            fd.set('label', label)
            fd.set('url', url)
            // The generic content path, so a social added here is the same row shape as
            // one added anywhere else — no second creation story to keep in step.
            const res = await addContentAction('link', artistId, fd)
            if (res?.error) return res.error
            setAdding(false)
            router.refresh()
            return null
          }}
        />
      )}

      <SaveLine status={status} />
    </div>
  )
}
