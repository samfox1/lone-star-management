'use client'

import { useState } from 'react'
import { canonicalHex } from '@/lib/color'
import { BrandSwatchProvider, ColorPalette, type NamedSwatch } from '../../editor/color-picker'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { toast } from '../../toast'
import { RowIcon } from '../_ui/row-icon'
import { setThemeColorAction } from '../actions'

/**
 * THE BROWSER BAR (BRAND_PAGE_PLAN.md, Tab icon tab): the colour a phone browser paints its
 * top bar on the site (`theme-color`, which sites start reading in a later round). The
 * Brand page's swatch + hex — ColorPalette's `row` variant, the standing rule for every
 * colour control — with the artist's brand colours first in its "On the site" swatches.
 *
 * Saves as you go, debounced, so a drag across the shade square is one write. Picking the
 * colour it already is, is not a change and writes nothing. With no colour yet, the row is
 * a + that opens the picker. A refusal is an error toast.
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
  // What the row shows; re-seeded when the server sends a different value (a refresh).
  const [shown, setShown] = useState({ from: saved, now: saved })
  if (shown.from !== saved) setShown({ from: saved, now: saved })

  const { save } = useDebouncedFieldSave<string>({
    persist: async (_key, hex) => {
      const res = await setThemeColorAction(artistId, hex || null)
      if (res.error) toast(res.error, 'error')
      return res
    },
  })

  function onChange(hex: string) {
    if ((canonicalHex(hex) || hex) === (canonicalHex(shown.now) || shown.now)) return
    setShown((s) => ({ ...s, now: hex }))
    save('theme_color', hex)
  }

  return (
    <BrandSwatchProvider colors={colors}>
      <ColorPalette
        variant="row"
        label="Browser bar"
        aria="Browser bar"
        value={shown.now}
        onChange={onChange}
        renderEmpty={(open) => <RowIcon icon="plus" label="Pick a color" variant="primary" onClick={open} />}
      />
    </BrandSwatchProvider>
  )
}
