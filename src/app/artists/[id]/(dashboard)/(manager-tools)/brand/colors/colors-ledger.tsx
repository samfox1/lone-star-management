'use client'

import { useCallback, useRef, useState } from 'react'
import {
  COLOR_SLOTS,
  COLOR_SLOT_NAMES,
  FIRST_ADDED_COLOR,
  MAX_ADDED_COLORS,
  nextColorName,
  type BrandColor,
  type ColorSlot,
} from '@/lib/manager-tools/brand/brand-colors'
import { useConfirm } from '../../../confirm-dialog'
import { toast } from '../../../toast'
import { deleteBrandColorAction } from '../actions'
import { AddRow } from '../../_ui/add-row'
import { ColorRow, type ColorItem } from './color-row'
import { ColorPlayground } from './playground'

/** The built-in rows' fixed guide text (Brand's approved exception to the no-instruction-
 *  copy rule). Keyed by every colour slot, so a third slot is a compile error here until
 *  it has its words. */
const GUIDE: Record<ColorSlot, string> = {
  primary: 'Your main color.',
  secondary: 'Your second color.',
}

/** The page's rows, from the server's palette: Primary and Secondary ALWAYS — from the slot
 *  list, not from the rows, so an unpicked one (no row at all) is still there — then the
 *  added colours in their order. */
function seedRows(colors: BrandColor[]): ColorItem[] {
  const builtIns = COLOR_SLOTS.map((slot): ColorItem => {
    const saved = colors.find((c) => c.slot === slot)
    return { key: `slot-${slot}`, id: saved?.id ?? null, slot, name: COLOR_SLOT_NAMES[slot], note: '', hex: saved?.hex ?? '' }
  })
  const added = colors
    .filter((c) => !c.slot)
    .map((c): ColorItem => ({ key: c.id, id: c.id, name: c.name, note: c.note ?? '', hex: c.hex }))
  return [...builtIns, ...added]
}

/**
 * BRAND → COLORS (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): PRIMARY and SECONDARY built in
 * ("default on the colors page, they just dont have to be filled in yet"), then a plain
 * palette — Color 3, Color 4, … with no other roles — that saves as you go. Colours are
 * dashboard-only this round, so there is no Publish step and nothing here lights the
 * Publish bar.
 *
 * A BUILT-IN has a fixed title, grey guide text, no note and no trash. It is "No color yet"
 * and a + until picked; the pick saves it (one upsert by slot, color-row.tsx), and so does
 * every pick after.
 *
 * The page's copy of the palette is seeded ONCE from the server and is the truth from then
 * on: every save revalidates the route, but the refreshed props would only echo what this
 * copy already holds — and re-seeding from them mid-drag would snap a swatch back to a
 * colour the manager has already moved past. A different visit is a fresh mount.
 *
 * ADD (the flow every Brand list shares, add-row.tsx): the name pre-fills the next free
 * "Color N" from 3, selected; the new row is client-only — "No color yet" and a + — until
 * its first colour, which is what saves it (color-row.tsx). Abandoning it leaves nothing.
 * The cap counts the built-ins, and keeps their room: at MAX_ADDED_COLORS the Add control
 * is simply gone, and Primary and Secondary can still be picked.
 */
export function ColorsLedger({
  artistId,
  colors,
  siteSwatches,
}: {
  artistId: string
  colors: BrandColor[]
  /** The site's own colours, offered in every row's panel as "On the site". */
  siteSwatches: string[]
}) {
  const [items, setItems] = useState<ColorItem[]>(() => seedRows(colors))
  const [preview, setPreview] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()
  /** Client keys for added rows. A ref: two adds in one tick must not share a key. */
  const nextKey = useRef(0)

  const patch = useCallback((key: string, p: Partial<ColorItem>) => {
    setItems((all) => all.map((it) => (it.key === key ? { ...it, ...p } : it)))
  }, [])

  function add(name: string) {
    nextKey.current += 1
    const key = `new-${nextKey.current}`
    setItems((all) => [...all, { key, id: null, name, note: '', hex: '', fresh: true }])
  }

  async function remove(item: ColorItem, done: { abandon: () => void }) {
    if (!item.id) {
      // Nothing of it reached the database, so there is nothing to ask about.
      done.abandon()
      setItems((all) => all.filter((it) => it.key !== item.key))
      return
    }
    if (!(await ask(`Remove ${item.name}?`, { action: 'Remove' }))) return
    const res = await deleteBrandColorAction(artistId, item.id)
    if (res.error) {
      toast(res.error, 'error')
      return
    }
    setItems((all) => all.filter((it) => it.key !== item.key))
  }

  const palette = items.filter((it) => it.hex).map((it) => ({ key: it.key, name: it.name, hex: it.hex }))
  const addedNames = items.filter((it) => !it.slot).map((it) => it.name)

  return (
    <>
      {items.map((item) => (
        <ColorRow
          key={item.key}
          artistId={artistId}
          item={item}
          guide={item.slot ? GUIDE[item.slot] : undefined}
          swatches={siteSwatches}
          onPatch={patch}
          onRemove={remove}
          onPreview={setPreview}
        />
      ))}
      {addedNames.length < MAX_ADDED_COLORS ? (
        <AddRow noun="color" onAdd={add} prefill={nextColorName(addedNames, FIRST_ADDED_COLOR)} maxLength={40} />
      ) : null}
      {preview && palette.some((c) => c.key === preview) ? (
        <ColorPlayground palette={palette} startKey={preview} onClose={() => setPreview(null)} />
      ) : null}
      {dialog}
    </>
  )
}
