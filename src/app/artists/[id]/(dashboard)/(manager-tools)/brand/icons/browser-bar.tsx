'use client'

import { useState } from 'react'
import { canonicalHex } from '@/lib/color'
import { BrandSwatchProvider, ColorPalette, type NamedSwatch } from '../../../editor/color-picker'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { toast } from '../../../toast'
import { RowIcon } from '../../_ui/row-icon'
import { setThemeColorAction } from '../actions'

/** The same colour, however it is written (#ABC, #aabbcc). */
const same = (a: string, b: string) => (canonicalHex(a) || a) === (canonicalHex(b) || b)

/**
 * THE BROWSER BAR (BRAND_PAGE_PLAN.md, Tab icon tab): the colour a phone browser paints its
 * top bar on the site (`theme-color`). It PUBLISHES with the Brand bar (20260925120000): the
 * site reads `brand.theme_color` from the published payload, so a pick raises the bar. The
 * Brand page's swatch + hex — ColorPalette's `row` variant, the standing rule for every
 * colour control — with the artist's brand colours first in its "On the site" swatches.
 *
 * Saves as you go, debounced, so a drag across the shade square is one write. Picking the
 * colour it already is, is not a change and writes nothing. With no colour yet, the row is
 * a + that opens the picker. A refusal is an error toast, and the saved colour comes back.
 *
 * A PICK OUTRANKS A REFRESH until the server has caught up with it (review 2, 2026-09-24):
 * every save revalidates the page, and the refresh carrying an EARLIER save could land
 * while a newer pick was still waiting — the row snapped back to it mid-pick. So the latest
 * pick is shown until the server says that colour (or refuses it); with none waiting, the
 * row shows whatever the server sends (a change from another tab, or the bar's Revert).
 */
export function BrowserBarColor({
  artistId,
  value,
  colors,
}: {
  artistId: string
  /** The saved `theme_color`, or null (left to the browser). */
  value: string | null
  /** The artist's palette, by name. */
  colors: readonly NamedSwatch[]
}) {
  const saved = value ?? ''
  /** The latest pick, until the server echoes it back (or refuses it). */
  const [pick, setPick] = useState<string | null>(null)
  // Caught up: the server now says the picked colour, so the row follows the server again.
  if (pick !== null && same(pick, saved)) setPick(null)
  const shown = pick ?? saved

  const { save } = useDebouncedFieldSave<string>({
    persist: async (_key, hex) => {
      let res: { error?: string }
      try {
        res = await setThemeColorAction(artistId, hex || null)
      } catch {
        res = { error: 'Couldn’t save the browser bar colour.' }
      }
      if (res.error) {
        toast(res.error, 'error')
        // Never saved, so never echoed: show the saved colour again — unless a newer pick
        // is already waiting, which keeps its place.
        setPick((p) => (p !== null && same(p, hex) ? null : p))
      }
      return res
    },
  })

  function onChange(hex: string) {
    if (same(hex, shown)) return
    setPick(hex)
    save('theme_color', hex)
  }

  return (
    <BrandSwatchProvider colors={colors}>
      <ColorPalette
        variant="row"
        label="Browser bar"
        aria="Browser bar"
        value={shown}
        onChange={onChange}
        renderEmpty={(open) => <RowIcon icon="plus" label="Pick a color" variant="primary" onClick={open} />}
      />
    </BrandSwatchProvider>
  )
}
