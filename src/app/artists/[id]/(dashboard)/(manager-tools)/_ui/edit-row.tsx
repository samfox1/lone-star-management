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
 * A click on another control inside the row (a button, a link, a field, a menu, a switch…)
 * keeps its own behaviour; so does a click that ends a text selection. A row with no trigger
 * (read-only, or one whose control is not a pencil) does nothing and keeps its cursor.
 *
 * The row is NOT a button (it holds other controls, and a button can't): a keyboard reaches
 * the pencil itself, which still shows on focus.
 */
export const EDIT_TRIGGER = { 'data-edit-trigger': '' } as const

/** Everything a click can land on that has its own job. */
const CONTROL = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  ...['button', 'link', 'switch', 'checkbox', 'radio', 'combobox', 'listbox', 'menu', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'slider', 'tab', 'textbox'].map(
    (r) => `[role="${r}"]`,
  ),
].join(',')

/** The pointer shows a hand only on a row that has something to open. */
const OPENS = 'has-[[data-edit-trigger]:not(:disabled)]:cursor-pointer'

/** The row's click: open its trigger, unless the click had a job of its own. */
export function openRowEdit(e: MouseEvent<HTMLElement>) {
  if (e.defaultPrevented) return
  const row = e.currentTarget
  const target = e.target
  // A portal's click (a modal opened from inside the row) bubbles through React, not the DOM.
  if (!(target instanceof Element) || !row.contains(target)) return
  const control = target.closest(CONTROL)
  if (control && row.contains(control)) return
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
  if (selection && !selection.isCollapsed && selection.anchorNode && row.contains(selection.anchorNode)) return
  // The trigger NEAREST the click (a modal row of three cells opens the cell whose label was
  // clicked), and only this row's own, never one in a row nested inside it.
  const own = (t: Element) => t.closest('[data-edit-row]') === row
  let trigger: HTMLElement | undefined
  for (let n: Element | null = target; n && !trigger; n = n === row ? null : n.parentElement) {
    trigger = Array.from(n.querySelectorAll<HTMLElement>('[data-edit-trigger]')).find(own)
  }
  if (!trigger || trigger.matches(':disabled')) return
  trigger.click()
}

/** A row that opens its pencil on a click anywhere on it. A div, so it can hold controls. */
export function EditRow({ className, children, ...props }: Omit<ComponentProps<'div'>, 'onClick'>) {
  return (
    <div {...props} data-edit-row="" onClick={openRowEdit} className={cx(EDIT_TARGET, OPENS, className)}>
      {children}
    </div>
  )
}
