'use client'

import { Icon } from '@/components/ui/icons'
import { SCROLL_BODY } from './inspector-shared'

/**
 * The FRAME every full-panel editor sits in — one back-chevron header, one optional
 * thumbnail, one scrolling body.
 *
 * Extracted because the image/video editor and the text-field editor had grown their own
 * copies of it: the same header markup, the same paddings, the same scroll container,
 * already one hex value apart. What genuinely differs between them is the MIDDLE (media
 * has a preview, Replace and Remove; text has an input), which is why this is a frame
 * with a slot rather than a component with a `kind` prop and two branches inside it.
 *
 * `onBack` is the only behaviour here. Anything an editor wants to do BEFORE leaving —
 * the item editor confirms unsaved changes — belongs to that editor, which passes a
 * handler that decides. This frame must never grow a reason to know what it contains.
 */
export function EditorPanel({
  label,
  thumb,
  onBack,
  children,
}: {
  /** Named in the header as "Edit <label>". */
  label: string
  /** A small identifying image (the item editors). Deliberately STATIC: the live preview
   *  is the site frame on the right, which is the one render that is true. */
  thumb?: React.ReactNode
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 pb-2.5 pt-[15px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex-none rounded-md p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        {thumb && (
          <span className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-lg bg-surface p-1.5">
            <span className="block w-full overflow-hidden">{thumb}</span>
          </span>
        )}
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">Edit {label}</h2>
      </div>

      <div className={SCROLL_BODY}>{children}</div>
    </>
  )
}
