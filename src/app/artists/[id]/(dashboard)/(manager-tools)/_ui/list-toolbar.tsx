'use client'

import { useRef, type ComponentProps, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icons'
import { cx } from '@/lib/cx'
import { FOCUS_RING } from './focus-ring'
import { HoverLabel } from './row-icon'

/**
 * THE LIST TOOLBAR (Subscribers, 2026-09-24; shared with Enquiries 2026-10-05, Sam: "Look at
 * subscribers, I want it to be closer to that set up"). An underline search on the left, a
 * row of plain words on the right (the chosen one bold ink), and whatever glyphs a tool adds.
 *
 * THE TOOLBAR STAYS, THE PAGE SCROLLS (Sam, 2026-09-24). The toolbar is `sticky` just under
 * the dashboard header and the rows scroll beneath it with the page. Not a scroll box of its
 * own: the page keeps its one native scrollbar, a phone's browser bars still collapse, and
 * Space / Page Down / find-in-page work as on any page. Anything between the toolbar and the
 * page that clips or scrolls (an `overflow-*`) would silently un-stick it; the Subscribers
 * component test walks the ancestors for exactly that.
 */

/** Under the dashboard header (layout.tsx): 59px tall below md, where its section nav is
 *  hidden, and 71px from md up; plus the notch inset, which is 0 unless the viewport is
 *  ever set to `viewport-fit=cover`. Measured in the browser, 2026-09-24. A page whose
 *  header does not stick (the roster) passes its own. */
export const STICKY_TOP = ['top-[calc(59px+env(safe-area-inset-top,0px))]', 'md:top-[calc(71px+env(safe-area-inset-top,0px))]']

/** THE LIST COLUMN (Sam, 2026-10-05: "decrease the width of inquiries and subscribers
 *  containers too a bit"): the two list pages read in a 960px column centred in the tools'
 *  one frame, as the AI test (660) and SEO › Profiles (800) read in theirs. Narrower screens
 *  are untouched: below 960px it is simply the full width. */
export const LIST_COLUMN = 'mx-auto w-full max-w-[960px]'

/** A list row's glyphs are faint until their row is hovered — with a MOUSE. A touch screen
 *  has no hover, so there they are always fully visible. */
export const TOUCH_VISIBLE = 'pointer-coarse:opacity-100'

/** The quiet line a list says instead of rows: "No subscribers yet.", "Nothing unread." */
export const QUIET = 'py-7 text-[14px] text-ink-faint'

export function ListToolbar({
  stickyTop = STICKY_TOP,
  children,
  ...rest
}: { stickyTop?: readonly string[]; children: ReactNode } & Omit<ComponentProps<'div'>, 'className' | 'children'>) {
  return (
    <div
      {...rest}
      // -mt-4 pt-4: at rest the search sits where it would without the padding; once stuck,
      // that padding is the breathing room under the header's hairline.
      className={cx('sticky z-20 -mt-4 flex flex-wrap items-center gap-2.5 border-b border-hairline bg-paper pb-3.5 pt-4', ...stickyTop)}
    >
      {children}
    </div>
  )
}

/** The search: a line, not a box (Sam, 2026-10-02: no bordered fields). × clears it and
 *  hands focus back to it. `label` is its placeholder and its accessible name. */
export function SearchLine({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="relative min-w-0 flex-1 basis-full sm:max-w-[420px] sm:basis-auto">
      <Icon name="search" size={16} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        className="w-full border-b border-hairline bg-transparent py-[9px] pl-[26px] pr-8 text-[14px] text-ink outline-hidden transition-colors placeholder:text-ink-faint focus:border-ink [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          className={cx('absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-ink-faint transition-colors hover:text-ink', FOCUS_RING)}
        >
          <Icon name="close" size={14} />
          <HoverLabel label="Clear search" align="end" />
        </button>
      ) : null}
    </div>
  )
}

/** One word of a WordChoice. `extra` rides after the word in faint mono (an unread count). */
export type Word<K extends string> = { key: K; label: string; extra?: ReactNode }

/** Plain words, the chosen one bold ink: no box, no pill (Sam, 2026-10-02). Subscribers' sort,
 *  Enquiries' filters. Wraps rather than overflow when a tool has many words. */
export function WordChoice<K extends string>({
  label,
  words,
  value,
  onChange,
}: {
  /** The group's accessible name: "Sort", "Filter". */
  label: string
  words: readonly Word<K>[]
  value: K
  onChange: (key: K) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-full flex-none flex-wrap gap-1 sm:ml-auto">
      {words.map((w) => {
        const on = w.key === value
        return (
          <button
            key={w.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(w.key)}
            className={cx(
              'whitespace-nowrap rounded-[7px] px-2 py-1.5 text-[12px] transition-colors focus-visible:outline-offset-1',
              FOCUS_RING,
              on ? 'font-semibold text-ink' : 'font-medium text-ink-muted hover:text-ink',
            )}
          >
            {w.label}
            {/* A real space, not a margin: the button's name reads "Unread 3", not "Unread3". */}
            {w.extra != null ? <> <span className="font-space text-[11px] font-normal text-ink-faint">{w.extra}</span></> : null}
          </button>
        )
      })}
    </div>
  )
}
