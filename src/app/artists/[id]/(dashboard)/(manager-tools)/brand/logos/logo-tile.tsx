import type { CSSProperties } from 'react'
import { cx } from '@/lib/cx'

/** The prototype's checkerboard at tile size (8px squares), so a transparent logo reads
 *  as transparent and a logo with a white box shows its box. */
export const TILE_CHECKER: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg,#e6e6e6 25%,transparent 25%),linear-gradient(-45deg,#e6e6e6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e6e6e6 75%),linear-gradient(-45deg,transparent 75%,#e6e6e6 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
}

/**
 * A logo row's tile (BRAND_PAGE_PLAN.md): 112×64, the logo on a checkerboard; with no
 * file, a dashed box that says "Add". Clicking it does what the row's icon does — open the
 * editor. It is a mouse shortcut only: the row's RowIcon ("Edit" / "Add logo") is the
 * keyboard's and the screen reader's way in, so the tile is out of the tab order and
 * hidden from the accessibility tree rather than a second control with the same name.
 */
export function LogoTile({ url, onClick }: { url: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-logo-tile={url ? 'file' : 'empty'}
      onClick={onClick}
      style={url ? TILE_CHECKER : undefined}
      className={cx(
        'relative grid h-16 w-28 flex-none cursor-pointer place-items-center overflow-hidden rounded-lg border border-hairline',
        !url && 'border-dashed text-[12px] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink',
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a storage render URL, already sized
        <img src={url} alt="" className="absolute inset-1.5 h-[calc(100%-12px)] w-[calc(100%-12px)] object-contain" />
      ) : (
        'Add'
      )}
    </button>
  )
}
