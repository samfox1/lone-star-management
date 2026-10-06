import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { type ManifestLinkRegion } from '@/lib/site-editor/manifest'
import { looksLikeEmail, safeHref } from '@/lib/url'
import { displayAddress } from '@/lib/manager-tools/format'
import { connectionHandle, connectionOfLink, methodOf, profileLink, type ConnectionDef } from '@/lib/connections'
import { parseHandle } from '@/lib/connect-methods'
import { type EditorLink } from '../inspector-types'
import { useScrollIntoFocus } from '../inspector-grid'
import { useDragReorder } from '../use-drag-reorder'
import { CONTROL_LABEL, NoSlots, onSiteOnly, openRowOnClick } from '../inspector-shared'
import { saveEditorLinkAction } from '../../actions'
import { ConnectionMark } from '../../(manager-tools)/_ui/connection-mark'
import { EditList, type EditListResult } from '../../(manager-tools)/_ui/edit-list'
import { AddPlus } from '../../(manager-tools)/_ui/add-row'
import { RowIcon } from '../../(manager-tools)/_ui/row-icon'
import { SelectToggle } from '../../select-toggle'
import { AddButtonModal } from '../add-button-modal'
import { useConfirm } from '../../confirm-dialog'

/*
 * THE LINKS PANEL'S LISTS, CLICK TO EDIT (Sam, 2026-10-05, prototypes/lists_before_after_20261002.html
 * §4: "Looks great, lets do it"). Every list here is the Settings › Email grammar (EditList,
 * _ui/edit-list.tsx): plain text at rest; a click opens the item as an underline field with ✓
 * and its trash; a bare + ends the list. No pencils, no pills, no words on buttons.
 */

/** The panel's type: Space Mono throughout (inputs restate it, they do not inherit it). */
const ROW_TEXT = 'font-space text-[13px] leading-6 text-ink'

/** Where a list's text starts, past the hover grip: the + lines up with it. */
function PlusRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2">
      <span className="w-4 flex-none" aria-hidden />
      {children}
    </div>
  )
}

/** The hover grip on a draggable row (the whole row drags; this only says so). */
function Grip() {
  return (
    <span className="flex-none cursor-grab text-ink-faint opacity-0 transition-opacity group-hover:opacity-60" aria-hidden>
      <Icon name="grip" size={16} />
    </span>
  )
}

/**
 * When the PREVIEW was clicked on dead space (`collapseAt` ticks), whatever item in this list
 * is open closes. An EditList item closes when its field loses focus, so the tick blurs it.
 */
function useCollapseOnTick(collapseAt: number) {
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur()
  }, [collapseAt])
  return ref
}

/* ── Site-link tools: set the href for each manifest-declared link button ────────────
 * The site declares its link-powered elements (USB / Merch buttons) in its manifest; here
 * the manager sets each one's URL BY KEY. Each is its KEY over its address as plain text; a
 * click opens the address as a line with ✓ (no trash and no +: the site declares these, and a
 * blank address means no link). An unset one shows a faint "Add a link", so a missing one is
 * visible rather than invisible. Saving writes a `links` row keyed by role and posts
 * `apply-link` so the frame updates live. Selecting the element in the frame opens its row. */
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
  /** Ticks when a preview click hit nothing editable — close the open row. */
  collapseAt?: number
  artistId: string
  onApplyLink?: (key: string, url: string) => void
}) {
  // What each button links to now: the saved values, then what this panel saved since.
  const [saved, setSaved] = useState<Record<string, string>>({})
  const rows = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const listRef = useCollapseOnTick(collapseAt)

  // A click on the button IN THE FRAME opens its row (and rings it, below). Nonce-gated by
  // `selected`'s identity: a REPEAT click on the same element is a new gesture (Sam, 2026-08-17).
  useEffect(() => {
    if (!selected) return
    const row = rows.current.get(selected.key)
    row?.scrollIntoView?.({ block: 'center' })
    const open = row?.querySelector('input')
    if (open) open.focus()
    else row?.querySelector('button')?.click()
  }, [selected])

  if (!regions.length) return <NoSlots noun="link" />

  return (
    <div ref={listRef} className="pb-2 pt-1">
      {regions.map((r) => {
        const url = saved[r.key] ?? values[r.key] ?? ''
        const isSelected = selected?.key === r.key
        return (
          <div
            key={r.key}
            ref={(el) => {
              rows.current.set(r.key, el)
            }}
            // The same accent ring every other selected thing wears (Sam, 2026-08-17). INSET:
            // an outside ring is clipped by the aside's overflow-hidden (2026-08-20).
            // A click anywhere on the row opens its address (Sam, 2026-10-05: the row is the target).
            onClick={openRowOnClick}
            className={cx('flex cursor-pointer flex-col gap-1 rounded-lg px-4 py-2.5', isSelected && 'ring-2 ring-accent ring-inset')}
            aria-current={isSelected ? 'true' : undefined}
          >
            {/* The site's description rides the key's hover title, so it never costs a row. */}
            <span className={CONTROL_LABEL} title={r.description}>
              {r.label}
            </span>
            <EditList
              items={[url]}
              text={(u) => u}
              label={`${r.label} URL`}
              placeholder="Add a link"
              maxLength={2048}
              inputMode="url"
              textClass={ROW_TEXT}
              className="min-w-0"
              // A blank clears the link; anything else must be a link the site can safely
              // use — the SAME safeHref the action uses, so the panel never claims a save the
              // server will refuse.
              validate={(v) => (v === '' || safeHref(v) !== undefined ? null : 'That isn’t a link the site can use.')}
              onSave={async (_, next) => {
                const res = await saveEditorLinkAction(artistId, r.key, next, r.label)
                if (!res.ok) return { error: res.error ?? 'Couldn’t save that link.' }
                setSaved((s) => ({ ...s, [r.key]: next }))
                onApplyLink?.(r.key, next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** A frame click on a link lands as `item:link:<label lowercased>` — the LABEL, because the
 *  row id never reaches the deployed site (socials arrive there as label-mapped config
 *  values), and lowercasing is the exact normalization that pipeline already joins on. */
function focusedLinkLabel(focusedKey: string | null | undefined): string | null {
  return focusedKey?.startsWith('item:link:') ? focusedKey.slice('item:link:'.length) : null
}

/** A link row that shows WHERE a frame click landed: scrolls into view and carries
 *  aria-current when it is the focused region. A plain div otherwise — every drag
 *  handler and class passes straight through. */
function FocusScroll({
  focused,
  rowRef,
  children,
  ...rest
}: { focused: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement> & {
  draggable?: boolean
  rowRef?: (el: HTMLDivElement | null) => void
}) {
  const ref = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div
      ref={(el) => {
        ref.current = el
        rowRef?.(el)
      }}
      aria-current={focused ? 'true' : undefined}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The link a social button saves from what was typed on its line — the rule Connections'
 * window saves by (connections/connection-modal.tsx): a handle platform builds its link from
 * the handle (a pasted link is read back to its handle first), a link platform's link is
 * checked the way Connect checks it. A row no connection owns takes any safe web link.
 */
function socialUrl(def: ConnectionDef | undefined, raw: string): { url: string } | { error: string } {
  const method = def ? methodOf(def) : undefined
  if (method?.kind === 'handle') {
    const parsed = parseHandle(method, raw)
    return 'error' in parsed ? parsed : { url: parsed.url }
  }
  if (def && method?.kind === 'link') return profileLink(def, { url: raw })
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  return safeHref(url) !== undefined ? { url } : { error: 'That isn’t a link the site can use.' }
}

/* ── Social buttons: the site's socials, each one a connection's link ──────────────
 * Sam, 2026-09-28: "when the connection is added, and I travel to the socials list in the
 * site editor, I can add a new button based on one of the existing connections that I
 * have… it should reference the link provided by the connection." And where a button is
 * switched on and off: "Only in the editor."
 *
 * So this lists the BUTTONS — the social links ON the site (`onSiteOnly`, the rule every
 * item panel lists by) — each as mark · name · handle. A click on the handle opens it as a
 * line with ✓ and a trash (Sam, 2026-10-05): the handle is the connection's own link, the
 * same one Connections edits. The trash takes the button OFF the site and deletes nothing,
 * so the connection stays. The + picks from the connections not on the site yet
 * (AddButtonModal) and turns THAT row on. Rows drag to reorder by id across the WHOLE list,
 * so the links not shown here keep their place. */
export function SocialButtons({
  links,
  artistId,
  onReorder,
  onToggleOnSite,
  onSaveUrl,
  focusedKey,
}: {
  /** Every social link, on the site and off it: the off ones are the picker's choices. */
  links: EditorLink[]
  artistId: string
  onReorder: (fromId: string, toId: string) => void
  /** The live toggle: on from the picker, off from an open row's trash. */
  onToggleOnSite: (l: EditorLink) => void
  /** Save a button's new link (its connection's row). `{ error }` keeps the field open. */
  onSaveUrl: (l: EditorLink, url: string) => Promise<EditListResult>
  /** The selected region's stable key (`item:link:<label lowercased>`). */
  focusedKey?: string | null
}) {
  const [adding, setAdding] = useState(false)
  const { dragProps, isOver } = useDragReorder(onReorder)
  const focusedLabel = focusedLinkLabel(focusedKey)

  return (
    <div className="pb-2 pt-1">
      {onSiteOnly(links).map((l) => {
        const def = connectionOfLink(l)
        // A row no connection owns (a label from before the vocabulary closed) still shows,
        // so it can be taken off the site; it just has no mark of its own.
        const name = def?.label ?? l.label
        const handle = def ? connectionHandle(def, l.url) : displayAddress(l.url)
        const isFocused = focusedLabel !== null && l.label.trim().toLowerCase() === focusedLabel
        return (
          <FocusScroll
            key={l.id}
            focused={isFocused}
            data-social-button={name}
            {...dragProps(l.id)}
            onClick={openRowOnClick}
            className={cx(
              'group flex cursor-pointer items-center gap-3 px-4 py-2',
              (isOver(l.id) || isFocused) && 'ring-2 ring-accent ring-inset',
            )}
          >
            <Grip />
            <span className="flex w-4 flex-none justify-center text-ink">
              {def ? <ConnectionMark def={def} size={15} /> : <Icon name="links" size={15} />}
            </span>
            <span className="flex-none text-[13px] text-ink">{name}</span>
            <EditList
              items={[l]}
              itemKey={(x) => x.id}
              text={() => handle}
              label={`${name} link`}
              maxLength={2048}
              textClass="font-space text-[12px] leading-6 text-ink-muted focus:text-ink"
              className="min-w-0 flex-1"
              onSave={async (_, raw) => {
                const next = socialUrl(def, raw)
                if ('error' in next) return next
                if (next.url === l.url) return
                return onSaveUrl(l, next.url)
              }}
              onRemove={() => onToggleOnSite(l)}
              removeLabel={() => `Remove the ${name} button`}
            />
          </FocusScroll>
        )
      })}

      {/* A bare + where the marks start (Sam, 2026-10-02: never "Add button" in words). It
          opens the picker in place, never a link out of the editor (Sam, 2026-08-09). */}
      <PlusRow>
        <AddPlus label="Add button" onClick={() => setAdding(true)} />
      </PlusRow>

      {adding && (
        <AddButtonModal
          artistId={artistId}
          links={links}
          onCancel={() => setAdding(false)}
          onPick={(l) => {
            setAdding(false)
            onToggleOnSite(l)
          }}
        />
      )}
    </div>
  )
}

/** A contact's address as the site uses it: a bare email becomes a mailto: link, the shape
 *  every saved contact row has. Anything else is saved as typed (the server checks it). */
function contactUrl(raw: string): string {
  return looksLikeEmail(raw) ? `mailto:${raw}` : raw
}

/* ── Contact links: a booking address, typed in place ────────────────────────────
 * A mailto:/tel: row is a contact route, not a profile to follow, so it is not a button
 * made from a connection: its label and address are edited here.
 *
 * At rest a contact is its LABEL alone (Sam, 2026-10-05: "Keep it just dont say what the
 * email is" — Skeen's site uses the contact form). A click opens the label and the address
 * as lines, with ✓, the trash (a DELETE, so it asks) and the on/off-site check, which shows
 * only while the contact is open. The + adds a new contact (label + address).
 *
 * ON-SITE ONLY, like every item panel (Sam, 2026-09-09; Contact followed 2026-09-28). A
 * contact taken off the site leaves the list. Contact addresses have no dashboard page of
 * their own to be the library, so the way back is here: the eye beside the + (shown only
 * when there are any) lists the off-site ones, and a click puts one back. A drag renumbers
 * the WHOLE list, so a hidden contact keeps its place. */
export function ContactLinkTools({
  links,
  onRemove,
  onReorder,
  onToggleOnSite,
  onSave,
  onAdd,
  focusedKey,
  collapseAt = 0,
}: {
  links: EditorLink[]
  onRemove: (l: EditorLink) => void
  onReorder: (fromId: string, toId: string) => void
  onToggleOnSite: (l: EditorLink) => void
  /** Save a contact's label and address. `{ error }` keeps the fields open. */
  onSave: (l: EditorLink, patch: { label: string; url: string }) => Promise<EditListResult>
  /** Add a contact (on the site). `{ error }` keeps the fields open. */
  onAdd: (label: string, url: string) => Promise<EditListResult>
  /** The selected region's stable key (`item:link:<label lowercased>`). */
  focusedKey?: string | null
  /** Ticks when a preview click hit nothing editable — close the open contact. */
  collapseAt?: number
}) {
  const listRef = useCollapseOnTick(collapseAt)
  const rows = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const [showingOff, setShowingOff] = useState(false)
  const offSite = links.filter((l) => !l.onSite)

  // A link selected in the FRAME opens its contact, or the "selected link" is a closed line
  // indistinguishable from its neighbours.
  const focusedLabel = focusedLinkLabel(focusedKey)
  const focusedRow = focusedLabel != null ? links.find((l) => l.label.trim().toLowerCase() === focusedLabel) : undefined
  const focusedId = focusedRow?.onSite ? focusedRow.id : null
  useEffect(() => {
    if (!focusedId) return
    const row = rows.current.get(focusedId)
    if (!row?.querySelector('input')) row?.querySelector('button')?.click()
  }, [focusedId])

  const { dragProps, isOver } = useDragReorder(onReorder)
  // The trash ASKS (Sam, 2026-09-28: "'are you sure' is good when its a delete"). Revert
  // never re-inserts a deleted contact: only a declared button's link comes back whole.
  const { ask, dialog } = useConfirm()
  async function remove(l: EditorLink) {
    if (await ask(`Delete ${l.label.trim() || 'this contact'}? This can't be undone.`)) onRemove(l)
  }

  /** Both are required: a blank one would be dropped by the server, so it is refused here. */
  const missing = (label: string, url: string) =>
    !label || !url ? 'A contact needs a label and an address.' : null

  return (
    <div ref={listRef} className="pb-2 pt-1">
      {dialog}
      {onSiteOnly(links).map((l) => (
        <FocusScroll
          key={l.id}
          focused={focusedRow?.id === l.id}
          rowRef={(el) => {
            rows.current.set(l.id, el)
          }}
          {...dragProps(l.id)}
          onClick={openRowOnClick}
          className={cx(
            'group flex cursor-pointer items-center gap-3 px-4 py-2',
            (isOver(l.id) || focusedRow?.id === l.id) && 'ring-2 ring-accent ring-inset',
          )}
        >
          <Grip />
          <EditList
            items={[l]}
            itemKey={(x) => x.id}
            text={(x) => x.label}
            label="Contact label"
            placeholder="Untitled"
            maxLength={100}
            textClass={ROW_TEXT}
            className="min-w-0 flex-1"
            detail={{ text: (x) => x.url, label: 'Address', maxLength: 2048 }}
            onSave={async (_, label, address = '') => {
              const problem = missing(label, address)
              if (problem) return { error: problem }
              return onSave(l, { label, url: contactUrl(address) })
            }}
            onRemove={() => void remove(l)}
            removeLabel={(x) => `Delete ${x.label.trim() || 'this contact'}`}
            extra={(x) => <SelectToggle selected={x.onSite} onSite={x.onSite} onToggle={() => onToggleOnSite(x)} label={x.label.trim() || 'Contact'} />}
          />
        </FocusScroll>
      ))}

      <PlusRow>
        <EditList
          items={[] as EditorLink[]}
          text={(x) => x.label}
          label="Contact label"
          addLabel="Add contact"
          addFieldLabel="New contact label"
          placeholder="Label"
          maxLength={100}
          textClass={ROW_TEXT}
          addFieldClass="w-[10ch] min-w-0"
          detail={{ text: (x) => x.url, label: 'Address', maxLength: 2048 }}
          onSave={() => undefined}
          onAdd={async (label, address = '') => {
            const problem = missing(label, address)
            if (problem) return { error: problem }
            return onAdd(label, contactUrl(address))
          }}
        />
        {offSite.length > 0 && (
          <RowIcon
            icon="eye"
            label="Contacts off the site"
            variant="bare"
            glyphSize={16}
            onClick={() => setShowingOff((s) => !s)}
          />
        )}
      </PlusRow>
      {showingOff &&
        offSite.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-label={`Put ${l.label.trim() || 'this contact'} on the site`}
            onClick={() => {
              setShowingOff(false)
              onToggleOnSite(l)
            }}
            className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] text-ink-faint transition-colors hover:text-ink"
          >
            <span className="w-4 flex-none" aria-hidden />
            <span className="truncate">{l.label.trim() || 'Untitled'}</span>
          </button>
        ))}
    </div>
  )
}

