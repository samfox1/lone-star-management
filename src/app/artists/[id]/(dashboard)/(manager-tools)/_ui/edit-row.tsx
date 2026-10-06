'use client'

import type { ComponentProps, MouseEvent } from 'react'
import { cx } from '@/lib/cx'
import { EDIT_TARGET } from './styles'

/**
 * A ROW WITH A HOVER PENCIL OPENS ON A CLICK ANYWHERE ON IT (Sam, 2026-10-05: "if I am hovering
 * over a row that has an edit button when I hover, I think that clicking anywhere on that row
 * should open the editing. I dont think that I should only be able to click the button to do
 * it").
 *
 *   EditRow             the row: an EDIT_TARGET (styles.ts) that listens for clicks. LedgerRow,
 *                       KvRow and CardField are EditRows.
 *   data-edit-trigger   on the control the row stands for: every `edit` RowIcon (its pencil),
 *                       a modal row's value (KvField, whose pencil is only a mark), the Profiles
 *                       tab's "Change photo" pencil. A click on the row CLICKS IT, so a pencil
 *                       that opens a modal, focuses a field or follows a link does exactly that.
 *
 *   data-add-trigger    on a row's + or upload glyph (RowIcon marks every `plus` and `upload`).
 *                       A row with NO pencil but one of these opens IT on a click anywhere
 *                       (Sam, 2026-10-05: "if there is no edit button, maybe because its a +
 *                       button because the user has to add something first, then clicking on
 *                       the row should also prompt the add or upload"). The click is a real
 *                       user click handed on synchronously, so a file picker still opens.
 *
 * A click on another control inside the row (a button, a link, a field, a menu, a switch…)
 * keeps its own behaviour; so does a click that ends a text selection. A row with no trigger
 * (read-only, or one whose control is neither a pencil nor a + / upload) does nothing and keeps
 * its cursor.
 *
 * An add is handed the click only if, when the press began, its + was already there and nothing
 * in the row was being typed in. A press on the row while one of its fields is open (a list item
 * being edited, a note) is a click away from that field, not a new add.
 *
 * The row is NOT a button (it holds other controls, and a button can't): a keyboard reaches
 * the pencil itself, which still shows on focus.
 */
export const EDIT_TRIGGER = { 'data-edit-trigger': '' } as const

/** On a + or upload glyph: what a click on a row WITHOUT a pencil stands for. */
export const ADD_TRIGGER = { 'data-add-trigger': '' } as const

/** Everything a click can land on that has its own job. A `dialog` is a panel opened INSIDE the
 *  row (the Brand colour palette): a click on its blank space is its own, or it re-clicked the
 *  row's + and closed the panel before a colour was picked. */
const CONTROL = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  ...['button', 'link', 'switch', 'checkbox', 'radio', 'combobox', 'listbox', 'menu', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'slider', 'tab', 'textbox', 'dialog'].map(
    (r) => `[role="${r}"]`,
  ),
].join(',')

/** The pointer shows a hand only on a row that has something to open (or add). */
const OPENS = 'has-[[data-edit-trigger]:not(:disabled)]:cursor-pointer has-[[data-add-trigger]:not(:disabled)]:cursor-pointer'

/** The trigger NEAREST the click (a modal row of three cells opens the cell whose label was
 *  clicked), and only this row's own, never one in a row nested inside it. */
function nearest(row: HTMLElement, from: Element, attr: string): HTMLElement | undefined {
  const own = (t: Element) => t.closest('[data-edit-row]') === row
  for (let n: Element | null = from; n; n = n === row ? null : n.parentElement) {
    const hit = Array.from(n.querySelectorAll<HTMLElement>(`[${attr}]`)).find(own)
    if (hit) return hit
  }
  return undefined
}

/** A field someone is typing in. */
const TYPING = 'input:not([type="file"]), textarea, select, [contenteditable]:not([contenteditable="false"])'

/** Whether each row's add may take the current press (see the note above). */
const addAtPress = new WeakMap<HTMLElement, boolean>()

/** The row's mousedown, before the press blurs or closes anything: may its + take this click? */
export function noteRowPress(e: MouseEvent<HTMLElement>) {
  const row = e.currentTarget
  const focused = typeof document === 'undefined' ? null : document.activeElement
  const typing = !!focused && focused !== row && row.contains(focused) && focused.matches(TYPING)
  addAtPress.set(row, !typing && !!nearest(row, row, 'data-add-trigger'))
}

/** The row's click: open its trigger, unless the click had a job of its own. */
export function openRowEdit(e: MouseEvent<HTMLElement>) {
  const row = e.currentTarget
  // Read and forget the press's note first, so no early return below leaves it for the next click.
  const hadAdd = addAtPress.get(row)
  addAtPress.delete(row)
  if (e.defaultPrevented) return
  const target = e.target
  // A portal's click (a modal opened from inside the row) bubbles through React, not the DOM.
  if (!(target instanceof Element) || !row.contains(target)) return
  const control = target.closest(CONTROL)
  if (control && row.contains(control)) return
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
  if (selection && !selection.isCollapsed && selection.anchorNode && row.contains(selection.anchorNode)) return
  // A pencil first; only a row with none hands the click to its + or upload glyph.
  let trigger = nearest(row, target, 'data-edit-trigger')
  if (!trigger && hadAdd !== false) trigger = nearest(row, target, 'data-add-trigger')
  if (!trigger || trigger.matches(':disabled')) return
  trigger.click()
}

/** A row that opens its pencil (or, with none, its + / upload) on a click anywhere on it. A div,
 *  so it can hold controls. */
export function EditRow({ className, children, ...props }: Omit<ComponentProps<'div'>, 'onClick' | 'onMouseDown'>) {
  return (
    <div {...props} data-edit-row="" onMouseDown={noteRowPress} onClick={openRowEdit} className={cx(EDIT_TARGET, OPENS, className)}>
      {children}
    </div>
  )
}
