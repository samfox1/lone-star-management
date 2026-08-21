import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type ManifestLinkRegion } from '@/lib/site-editor/manifest'
import { safeHref } from '@/lib/url'
import { platformFromUrl } from '@samfox1/site-bridge/social'
import { type EditorLink } from '../inspector-types'
import { useScrollIntoFocus } from '../inspector-grid'
import {
  EditRow,
  SaveLine,
  OnSiteToggle,
  NoSlots,
  EYEBROW,
  INVALID_FIELD,
  FIELD,
  FIELD_ON_TINT,
  useCollapseOnOutsideClick,
} from '../inspector-shared'
import { useSignal } from '../use-signal'
import { useDragReorder } from '../use-drag-reorder'
import { useDebouncedFieldSave } from '../use-debounced-field-save'
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
  collapseAt = 0,
  artistId,
  onApplyLink,
}: {
  regions: ManifestLinkRegion[]
  values: Record<string, string>
  selected: { key: string; nonce: number } | null
  /** Ticks when a preview click hit nothing editable — collapse the open row. */
  collapseAt?: number
  artistId: string
  onApplyLink?: (key: string, url: string) => void
}) {
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? ''])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const fieldRefs = useRef<Map<string, HTMLInputElement | null>>(new Map())
  // Manifest labels, so the (unmount) flush can name each row without the region list
  // being an effect dependency (same trick as SupportLinkTools' linksRef).
  const labelsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    labelsRef.current = Object.fromEntries(regions.map((r) => [r.key, r.label]))
  }, [regions])

  // A link's URL is trimmed before it is saved, but the box keeps the raw text; a blank
  // clears the link (valid), a non-blank one must be a safe http(s)/relative URL —
  // validated with the SAME safeHref the action uses, so the panel can't claim "Saved" on
  // a write the server will reject. The label rides along from the manifest at save time.
  const { status, save } = useDebouncedFieldSave<string>({
    persist: (key, url) => saveEditorLinkAction(artistId, key, url, labelsRef.current[key] ?? key),
    normalize: (raw) => {
      const trimmed = raw.trim()
      return trimmed === '' || safeHref(trimmed) !== undefined ? trimmed : null
    },
    onApply: onApplyLink,
  })

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
  // A click anywhere outside the open row (or Escape) collapses it.
  const openRef = useCollapseOnOutsideClick(openKey !== null, () => setOpenKey(null))
  // A preview click that hit nothing editable collapses the open row too. Compared
  // against the last seen tick (an event, not a state) so the manager can immediately
  // open another row afterwards.
  const [lastCollapse, setLastCollapse] = useState(collapseAt)
  if (collapseAt !== lastCollapse) {
    setLastCollapse(collapseAt)
    setOpenKey(null)
  }

  // A click on the button IN THE FRAME opens its row. Reset-on-prop-change DURING render
  // (the repo's sanctioned pattern), not in an effect — an effect setState cascades a
  // render and the lint rule rightly rejects it. The scroll/focus is a real side effect,
  // so it stays in the effect below, keyed off the now-open row.
  // Nonce-gated, like every other routed select: a REPEAT click on the same element is
  // a new gesture and must re-open/re-scroll (Sam, 2026-08-17).
  useSignal(selected, (s) => setOpenKey(s.key))
  useEffect(() => {
    if (!selected) return
    const el = fieldRefs.current.get(selected.key)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [selected])

  function edit(key: string, raw: string) {
    setText((t) => ({ ...t, [key]: raw }))
    const ok = save(key, raw) // normalize + optimistic paint + debounced persist, all in the hook
    setInvalid((s) => {
      const next = new Set(s)
      if (ok) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!regions.length) return <NoSlots noun="link" />

  return (
    <div className="pb-2 pt-1">
      {regions.map((r) => {
        const url = text[r.key] ?? ''
        const isOpen = openKey === r.key
        return (
          <div
            key={r.key}
            ref={isOpen ? openRef : undefined}
            // The same accent ring every other selected thing wears. The row already
            // OPENED on a frame click, but opening alone did not read as "this is the
            // one you clicked" (Sam, 2026-08-17, wren's Listen button).
            // INSET: these rows span the panel's full width, and an outside ring is
            // clipped by the aside's overflow-hidden (Sam's screenshot, 2026-08-20).
            className={cx('rounded-lg', selected?.key === r.key && 'ring-2 ring-accent ring-inset')}
            aria-current={selected?.key === r.key ? 'true' : undefined}
          >
            {/* The URL is plain text until the pencil opens the box (no "lit" editable
                link, no bolt icon). The site's `description` rides the row's hover title
                and the box's accessible description, so it never costs a row. */}
            <div title={r.description}>
              <EditRow
                label={r.label}
                value={url || 'Add a link'}
                empty={!url}
                expanded={isOpen}
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
  boundaryRef,
  children,
  ...rest
}: { focused: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & {
  draggable?: boolean
  /** Published to the caller when this row is the OPEN one, so the outside-click
   *  hook can tell "inside the row I'm editing" from "somewhere else". */
  boundaryRef?: React.RefObject<HTMLDivElement | null>
}) {
  const ref = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div
      ref={(el) => {
        ref.current = el
        if (boundaryRef) boundaryRef.current = el
      }}
      aria-current={focused ? 'true' : undefined}
      {...rest}
    >
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
  inferPlatform = false,
  focusedKey,
  collapseAt = 0,
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
  /** Infer the label (and so the icon) from the URL, hiding the Label field. On for
   *  Socials, off for Contact (whose label is a manager-chosen name, not a platform). */
  inferPlatform?: boolean
  onToggleOnSite: (l: EditorLink) => void
  /** The selected region's stable key. A social icon in the frame posts
   *  `item:link:<label lowercased>` — the LABEL, because the row id never reaches the
   *  deployed site (socials arrive there as label-mapped config values), and lowercasing
   *  is the exact normalization that pipeline already joins on. */
  focusedKey?: string | null
  /** Ticks when a preview click hit nothing editable — collapse the open row. */
  collapseAt?: number
}) {
  const [values, setValues] = useState<Record<string, { label: string; url: string }>>(() =>
    Object.fromEntries(links.map((l) => [l.id, { label: l.label, url: l.url }])),
  )
  const [adding, setAdding] = useState(false)
  const router = useRouter()
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  // Which row is expanded. Rows collapse to just their label; clicking one opens the
  // edit/remove controls below it (single-open accordion — keeps the list short).
  const [open, setOpen] = useState<string | null>(null)
  // A click anywhere outside the open row (or Escape) collapses it.
  const rowOpenRef = useCollapseOnOutsideClick(open !== null, () => setOpen(null))
  // Same collapse-on-preview-deselect tick as the other lists.
  const [lastCollapse, setLastCollapse] = useState(collapseAt)
  if (collapseAt !== lastCollapse) {
    setLastCollapse(collapseAt)
    setOpen(null)
  }

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
  const { dragProps, isOver } = useDragReorder(onReorder)

  // Both label and url are required — a blank one is dropped, not saved. The pending
  // row itself is what the (unmount) flush persists, so there is no separate values ref.
  const { status, save } = useDebouncedFieldSave<{ label: string; url: string }>({
    persist: (id, v) => {
      const fd = new FormData()
      fd.set('label', v.label)
      fd.set('url', v.url)
      return updateContentAction('link', id, artistId, fd)
    },
    normalize: (v) => (v.label.trim() !== '' && v.url.trim() !== '' ? v : null),
  })

  function edit(id: string, patch: Partial<{ label: string; url: string }>) {
    const row = { ...(values[id] ?? { label: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const ok = save(id, row)
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
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
            boundaryRef={isOpen ? rowOpenRef : undefined}
            {...dragProps(l.id)}
            className={cx(
              (isOver(l.id) || isFocused) && 'ring-2 ring-accent ring-inset',
              rowInvalid && 'ring-1 ring-accent-red',
            )}
          >
            {/* The shared version-A row (EditRow): label over URL as plain text, a
                hover grip (the reorder handle — the whole row still drags), an "Off"
                tag for an off-site link, and the hover pencil that reveals the box
                below. The pencil is numbered per list so Socials + Contact don't
                collide. */}
            <EditRow
              grip
              label={v.label.trim() || 'Untitled link'}
              value={v.url.trim() || 'Add a link'}
              empty={urlBlank}
              trailing={!l.onSite ? <span className={cx(EYEBROW, 'flex-none')}>Off</span> : undefined}
              expanded={isOpen}
              editLabel={`${group.toLowerCase()} link ${i + 1}`}
              onEdit={() => setOpen(isOpen ? null : l.id)}
            />

            {isOpen && (
              // Condensed box (Sam, 2026-08-12): bare inputs, no per-field icon/label
              // chrome, a tight toggle + remove line. A social has no Label field — the
              // platform (and icon) is inferred from the URL; a CONTACT link keeps its
              // manager-chosen name.
              <div className="space-y-1.5 bg-surface px-4 pb-2.5 pt-1.5">
                {!inferPlatform && (
                  <input
                    aria-label={`${group} link ${i + 1} label`}
                    aria-invalid={(rowInvalid && labelBlank) || undefined}
                    value={v.label}
                    onChange={(e) => edit(l.id, { label: e.target.value })}
                    placeholder="Label"
                    className={cx(FIELD_ON_TINT, rowInvalid && labelBlank && INVALID_FIELD)}
                  />
                )}
                <input
                  aria-label={`${group} link ${i + 1} URL`}
                  aria-invalid={(rowInvalid && urlBlank) || undefined}
                  type="url"
                  value={v.url}
                  onChange={(e) => {
                    const url = e.target.value
                    // Infer the platform (→ label → icon) from the URL for a social. A
                    // recognised host renames the row; an unknown one keeps whatever
                    // label the modal set, so the row still has a name.
                    const inferred = inferPlatform ? platformFromUrl(url) : null
                    edit(l.id, inferred ? { url, label: inferred.label } : { url })
                  }}
                  placeholder="https://…"
                  className={cx(FIELD_ON_TINT, rowInvalid && urlBlank && INVALID_FIELD)}
                />
                <div className="flex items-center justify-between pt-0.5">
                  <OnSiteToggle on={l.onSite} onToggle={() => onToggleOnSite(l)} />
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
