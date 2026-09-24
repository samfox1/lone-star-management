'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { MAX_FONT_LABEL, type BrandFont } from '@/lib/fonts'
import { RowTitle, type SaveResult } from '../_ui/inline-text'
import { FontSample } from './font-sample'

/** Is this key press for a name being typed (a contentEditable in the menu), not the menu? */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('[contenteditable="true"]') !== null

/**
 * THE CHANGE MENU (BRAND_PAGE_PLAN.md, Fonts; the prototype's `.cp.fm`): a small paper
 * card that opens to the LEFT of the row's chevrons (or +), never over the row. The
 * artist's fonts, each set in its own face, the current one bold; then "Upload a font…".
 * Below 900px the row's controls sit on the left, so the menu drops below instead.
 *
 * It only REPORTS the choice: whether a pick is a change (the same font is not) is the
 * row's decision, because only the row knows what it holds.
 *
 * The bin beside each font removes it from the library. The plan's menu has none, but a
 * library capped at MAX_FONTS_PER_ARTIST with no way out would refuse the thirteenth
 * upload with "Remove one before adding another" and nowhere to do it.
 *
 * The pencil beside it RENAMES the font (Sam, 2026-09-23: Skeen's arrived as "Sorg_Font"):
 * the name turns into the titles' inline field in place (RowTitle — a thin underline on
 * focus, Enter or a click away saves, Escape puts it back), still set in its own face. The
 * menu stays open; the new name shows at once. Only the label changes, never the family.
 *
 * Closes on a click outside (the trigger itself excepted — it toggles), and on Escape in
 * the capture phase, so an Escape meant for the menu closes nothing underneath it — unless
 * a name is being typed: that Escape belongs to the field (it cancels the rename), and the
 * next one closes the menu. A click outside — the trigger included — first SAVES a name
 * being typed ("click away saves"): the close unmounts the field, and a field taken out of
 * the page never blurs, so the name went with it (review 2, 2026-09-24).
 */
export function FontMenu({
  fonts,
  currentId,
  anchor,
  onPick,
  onUpload,
  onRemove,
  onRename,
  onClose,
}: {
  fonts: BrandFont[]
  /** The font the row holds, or null. */
  currentId: string | null
  /** The control that opened it: a click on it is a toggle, not "outside". */
  anchor: RefObject<HTMLElement | null>
  onPick: (font: BrandFont) => void
  onUpload: () => void
  onRemove: (font: BrandFont) => void
  /** Save a font's new name. A refusal comes back as `{ error }` (the field toasts it). */
  onRename: (font: BrandFont, label: string) => Promise<SaveResult> | SaveResult
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  /** The font whose name is being typed, or null. */
  const [editing, setEditing] = useState<string | null>(null)
  /** Hand focus back to this font's entry once its name field has gone (Enter, Escape). */
  const refocus = useRef<string | null>(null)

  // The field takes focus as it opens; when it closes by Enter or Escape (a blur to
  // nowhere), its entry gets focus back, so the keyboard stays in the menu.
  useEffect(() => {
    const menu = ref.current
    if (editing) {
      const field = menu?.querySelector<HTMLElement>('[data-renaming] [role="textbox"]')
      field?.focus()
      // Select the whole old name, so typing REPLACES it (final visual check, 2026-09-24:
      // with the caret at the start, typing prepended — "…RenamedVisual Check Sans").
      if (field) {
        const range = document.createRange()
        range.selectNodeContents(field)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
      return
    }
    const id = refocus.current
    refocus.current = null
    if (!id || !menu) return
    for (const el of menu.querySelectorAll<HTMLElement>('[data-font-id]')) if (el.dataset.fontId === id) el.focus()
  }, [editing])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      // Blur is what saves the name (RowTitle); do it while the field is still here.
      const field = ref.current?.querySelector<HTMLElement>('[data-renaming] [role="textbox"]')
      if (field && field === document.activeElement) field.blur()
      if (anchor.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (typing(e.target) && ref.current?.contains(e.target as Node)) return // the rename's own Escape
      e.stopImmediatePropagation()
      onClose()
      anchor.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  // Focus moves in on open — to the current font, else the first entry — so the add
  // flow's keyboard path (note → Enter → + → Enter) lands somewhere it can choose from.
  useEffect(() => {
    const menu = ref.current
    const target = menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[data-menu-item]')
    target?.focus()
  }, [])

  /** Up/Down walk the fonts and Upload (the bins are Tab stops, not in the walk). */
  function walk(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (typing(e.target)) return // arrows move the caret in a name being typed
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Fonts"
      onKeyDown={walk}
      className={cx(
        'absolute left-0 top-[calc(100%+8px)] z-30 w-[220px] rounded-xl border border-hairline bg-paper p-2 text-left shadow-[0_12px_32px_rgba(0,0,0,0.08)]',
        'min-[900px]:left-auto min-[900px]:right-[calc(100%+12px)] min-[900px]:top-1/2 min-[900px]:-translate-y-1/2',
      )}
    >
      {fonts.length ? (
        <p aria-hidden="true" className="mx-1.5 mb-1.5 mt-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          Fonts
        </p>
      ) : null}
      <div className="max-h-[280px] overflow-auto">
        {fonts.map((font) => {
          const on = font.id === currentId
          if (editing === font.id)
            return (
              <div
                key={font.id}
                data-renaming=""
                onBlur={(e) => {
                  // Enter and Escape blur the field to nowhere: give its entry focus back.
                  // A click elsewhere takes focus with it, and keeps it.
                  if (!e.relatedTarget) refocus.current = font.id
                  setEditing(null)
                }}
                // The field is RowTitle's (15px, medium); here it wears the entry's own size
                // and weight so the name does not jump as it becomes editable.
                className={cx(
                  'min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[15px] text-ink',
                  '[&_[role=textbox]]:[font-size:inherit] [&_[role=textbox]]:[font-weight:inherit]',
                  on && 'font-bold',
                )}
              >
                <FontSample family={font.family} cap={11} fallback={15}>
                  <RowTitle value={font.label} onRename={(label) => onRename(font, label)} label="Font name" maxLength={MAX_FONT_LABEL} />
                </FontSample>
              </div>
            )
          return (
            <div key={font.id} className="group/fo flex items-center gap-1">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={on}
                data-menu-item=""
                data-font-id={font.id}
                onClick={() => onPick(font)}
                className={cx(
                  'block min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-[15px] text-ink outline-none hover:bg-surface-hover focus-visible:bg-surface-hover',
                  on && 'font-bold',
                )}
              >
                <FontSample family={font.family} cap={11} fallback={15}>{font.label}</FontSample>
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={`Rename ${font.label}`}
                onClick={() => setEditing(font.id)}
                className="flex-none rounded-md p-1.5 text-ink-faint opacity-0 outline-hidden transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent group-hover/fo:opacity-100"
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={`Remove ${font.label}`}
                onClick={() => onRemove(font)}
                className="flex-none rounded-md p-1.5 text-ink-faint opacity-0 outline-hidden transition-opacity hover:text-accent-red focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent group-hover/fo:opacity-100"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        role="menuitem"
        data-menu-item=""
        onClick={onUpload}
        className={cx(
          'block w-full rounded-lg px-2.5 py-2 text-left font-ui text-[13px] text-ink-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover',
          fonts.length > 0 && 'mt-1 rounded-t-none border-t border-hairline',
        )}
      >
        Upload a font…
      </button>
    </div>
  )
}
