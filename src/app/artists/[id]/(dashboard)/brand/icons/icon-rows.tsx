'use client'

import { useState } from 'react'
import type { FaviconFraming, IconTarget } from '@/lib/brand'
import { cx } from '@/lib/cx'
import type { NamedSwatch } from '../../editor/color-picker'
import { LedgerRow, LedgerSection } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'
import { ICON_SHAPE, IconEditor, IconLivePreview, type IconLogo, type IconSourceRef } from '../favicon-editor'
import { BrowserBarColor } from './browser-bar'

/** One icon row's data, resolved on the server. */
export type IconRowData = {
  /** The generated 180px PNG (the working row), or null before the first save. */
  generatedUrl: string | null
  source: IconSourceRef
  framing: FaviconFraming
}

/** The built-in rows (BRAND_PAGE_PLAN.md): a fixed title and fixed grey guide text — an
 *  approved exception to the no-instruction-copy rule, Brand only. No notes, no rename. */
const ICONS: { target: IconTarget; title: string; guide: string }[] = [
  { target: 'favicon', title: 'Tab icon', guide: 'Browser tabs and bookmarks.' },
  { target: 'home_icon', title: 'Home-screen icon', guide: 'When a fan saves the site to their phone.' },
]

/** A light checkerboard, so a transparent icon reads as transparent. */
const CHECKER = 'bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:12px_12px]'

/**
 * BRAND → TAB ICON (Sam, 2026-09-23): three ledger rows. The tab icon (a 64px preview) and
 * the home-screen icon (a phone's rounded square) each show the GENERATED file — what a
 * publish sends — with a pencil that opens its editor. Before there is a file, the row draws
 * the icon live from its source and framing (the same `drawFavicon`), so it is never blank
 * while there is something to frame. The browser bar is a swatch + hex.
 */
export function IconRows({
  artistId,
  favicon,
  homeIcon,
  logos,
  themeColor,
  colors,
}: {
  artistId: string
  favicon: IconRowData
  homeIcon: IconRowData
  logos: IconLogo[]
  themeColor: string | null
  colors: readonly NamedSwatch[]
}) {
  const [open, setOpen] = useState<IconTarget | null>(null)
  const data: Record<IconTarget, IconRowData> = { favicon, home_icon: homeIcon }
  const editing = ICONS.find((i) => i.target === open)

  return (
    <LedgerSection label="Tab icon">
      {ICONS.map(({ target, title, guide }) => (
        <LedgerRow key={target} title={title} guide={guide}>
          <IconPreview target={target} title={title} row={data[target]} />
          <RowIcon icon="edit" label="Edit" onClick={() => setOpen(target)} />
        </LedgerRow>
      ))}
      <LedgerRow title="Browser bar" guide="The phone browser's top bar on the site.">
        <BrowserBarColor artistId={artistId} value={themeColor} colors={colors} />
      </LedgerRow>
      {editing ? (
        <IconEditor
          // A fresh editor per icon: its framing and source are seeded once, on open.
          key={editing.target}
          artistId={artistId}
          target={editing.target}
          label={editing.title}
          initialFraming={data[editing.target].framing}
          source={data[editing.target].source}
          logos={logos}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </LedgerSection>
  )
}

/** The row's preview, in that icon's shape (clipped to it): the generated file, or — before
 *  there is one — the icon drawn live from its source and framing. */
function IconPreview({ target, title, row }: { target: IconTarget; title: string; row: IconRowData }) {
  const shape = ICON_SHAPE[target]
  return (
    <span data-icon-shape={shape.name} className={cx('block flex-none overflow-hidden border border-hairline', shape.row, CHECKER)}>
      {row.generatedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.generatedUrl} alt={title} className="h-full w-full object-contain" />
      ) : row.source.url ? (
        <IconLivePreview url={row.source.url} framing={row.framing} label={title} className="h-full w-full" />
      ) : null}
    </span>
  )
}
