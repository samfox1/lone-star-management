'use client'

import type { ReactNode } from 'react'
import { PortalModal } from '@/components/ui/portal-modal'
import { buttonClass } from '@/components/ui/ui'

/** The card: a FIXED shape. At most the viewport minus 32px tall, never taller, so a
 *  long control column can never push Save off the screen. Only the middle scrolls. */
const CARD = 'relative flex max-h-[calc(100dvh-32px)] max-w-full flex-col overflow-hidden rounded-2xl bg-paper font-ui text-ink shadow-2xl'

/** Save is the same pill every dashboard modal closes with (CardModal's). */
const SAVE = buttonClass('confirm', 'min-w-[88px] justify-center')

/**
 * THE BRAND EDITOR MODAL (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): "fixed shape, two columns
 * so it never outgrows the screen; middle scrolls, header and Save stay". Board on the
 * left (ModalBoard), controls on the right; below 760px they stack.
 *
 * Built on PortalModal, not a new modal system: it brings the portal, the body-scroll lock,
 * the backdrop click, the × and the capture-phase Escape that closes only the top modal.
 *
 * The footer button says SAVE, never Done (the site-wide rule). Controls inside save
 * themselves as they go, so Save closes unless `onSave` says otherwise — the name is
 * what the manager means by pressing it.
 */
export function BrandModal({
  label,
  meta,
  square,
  onClose,
  onSave,
  board,
  footerLeft,
  beforeSave,
  fit = false,
  controlsAlign = 'center',
  children,
}: {
  /** The thing's name: the dialog's accessible name and its title. */
  label: string
  /** One mono word under the title ("edit", "preview"). */
  meta?: string
  /** A 36px thumbnail before the title. */
  square?: ReactNode
  onClose: () => void
  /** What Save does. Default: close. */
  onSave?: () => void
  /** The left column — usually a ModalBoard. Without it the controls take the width. */
  board?: ReactNode
  /** The far left of the footer. */
  footerLeft?: ReactNode
  /** Immediately LEFT of Save, grouped with it on the right of the footer (the icon
   *  editor's Reset). */
  beforeSave?: ReactNode
  /** The right column: the controls. */
  children: ReactNode
  /** Board-only editors (the logo): the card hugs the board and anything else stacks
   *  under it, instead of the two-column 760px shape (Sam, 2026-09-23: "the wrong size"). */
  fit?: boolean
  /** Two-column shape only: `center` (default) centres the controls beside the board;
   *  `start` tops them level with the board's top edge (the icon editor, Sam 2026-09-23). */
  controlsAlign?: 'center' | 'start'
}) {
  const save = (
    <button type="button" onClick={onSave ?? onClose} className={SAVE}>
      Save
    </button>
  )
  return (
    <PortalModal ariaLabel={label} onClose={onClose} cardClass={`${CARD} ${fit ? 'w-auto' : 'w-[760px]'}`}>
      <header className="flex flex-none items-center gap-3 border-b border-hairline py-4 pl-5 pr-14">
        {square ? <div className="h-9 w-9 flex-none overflow-hidden rounded-[10px] bg-surface">{square}</div> : null}
        <h2 className="min-w-0 truncate text-[15px] font-bold">{label}</h2>
        {meta ? <span className="flex-none font-space text-[11px] uppercase tracking-[0.06em] text-ink-faint">{meta}</span> : null}
      </header>
      <div data-modal-body="" className="min-h-0 flex-1 overflow-auto p-5">
        {board && fit ? (
          <div className="flex flex-col items-center gap-5">
            {board}
            <div className="flex w-[320px] max-w-full min-w-0 flex-col gap-3 empty:hidden">{children}</div>
          </div>
        ) : board ? (
          <div className={`grid grid-cols-1 ${controlsAlign === 'start' ? 'items-start' : 'items-center'} gap-7 min-[760px]:grid-cols-[320px_minmax(0,1fr)]`}>
            <div className="flex justify-center">{board}</div>
            <div className="flex min-w-0 flex-col gap-5">{children}</div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-5">{children}</div>
        )}
      </div>
      <footer className="flex flex-none items-center justify-between gap-3 border-t border-hairline px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">{footerLeft}</div>
        {beforeSave ? (
          <div className="flex flex-none items-center gap-3">
            {beforeSave}
            {save}
          </div>
        ) : (
          save
        )}
      </footer>
    </PortalModal>
  )
}
