'use client'

import { useEffect, useRef } from 'react'
import type { BrandColor, ColorSlot } from '@/lib/brand-colors'
import { canonicalHex } from '@/lib/color'
import { ColorPalette } from '../../editor/color-picker'
import { toast } from '../../toast'
import {
  addBrandColorAction,
  deleteBrandColorAction,
  renameBrandColorAction,
  setBrandColorHexAction,
  setBrandColorNoteAction,
  setBrandColorSlotAction,
} from '../actions'
import { LedgerRow } from '../_ui/ledger'
import { RowIcon } from '../_ui/row-icon'

/** One colour as the page holds it. `id` is null until the row has been saved — a row the
 *  manager has named but not yet given a colour lives only here. */
export type ColorItem = {
  /** React's key: the colour's id, or the client key it was added under (kept after the
   *  save, so the row — and a panel open on it — is not remounted by getting an id). */
  key: string
  id: string | null
  name: string
  note: string
  /** '' until the first pick. */
  hex: string
  /** Added this visit: its note takes focus on mount (the add flow's third step). */
  fresh?: boolean
  /** A built-in (Primary, Secondary): fixed title, guide text, no note, no trash, and
   *  every save is by slot. Absent on an added colour. */
  slot?: ColorSlot
}

/** How long the colour must hold still before it is saved. A drag across the square is
 *  sixty changes a second; the database wants the one it ended on. */
export const SAVE_DELAY_MS = 300

/**
 * ONE ROW OF THE PALETTE (BRAND_PAGE_PLAN.md, Colors). A renamable title, a note, and the
 * swatch + hex (ColorPalette's row presentation), then the eye and a faint trash.
 *
 * SAVING A COLOUR. The swatch and hex follow every change at once (`onPatch`); the save
 * waits out SAVE_DELAY_MS and then sends only where the colour ENDED, and only if that is
 * not what the database already holds — so picking the colour it already is, or dragging
 * away and back, calls nothing. One save is in flight at a time; a change made meanwhile
 * goes when it returns. A refusal is an error toast and the saved colour comes back.
 *
 * AN UNSAVED ROW is saved by its first colour: that save is the ADD, carrying the name and
 * note the row was given, and every save after it is a change to the colour it made. A
 * rename or a note typed while the add is in flight follows it once the row exists.
 * Leaving the page mid-debounce still sends the pick; removing an unsaved row sends nothing
 * (and a row removed while its add was in flight is deleted again when the add returns).
 *
 * A BUILT-IN (Primary, Secondary) saves BY SLOT, first pick and every pick after — one
 * upsert that makes the row or changes it — so it never needs to know its id, and two tabs
 * picking Primary can never make two. Its title and guide are fixed; it has no note or trash.
 */
export function ColorRow({
  artistId,
  item,
  guide,
  swatches,
  onPatch,
  onRemove,
  onPreview,
}: {
  artistId: string
  item: ColorItem
  /** A built-in's fixed grey guide text. */
  guide?: string
  /** The site's colours, for the panel's "On the site" grid. */
  swatches: string[]
  /** Record a change on the page's copy of this row. */
  onPatch: (key: string, patch: Partial<ColorItem>) => void
  /** The trash. `abandon` marks a row that never reached the database. */
  onRemove: (item: ColorItem, done: { abandon: () => void }) => void
  /** The eye: open the playground on this colour. */
  onPreview: (key: string) => void
}) {
  const plusRef = useRef<HTMLButtonElement>(null)

  // Everything the save loop reads lives in refs: it runs in timers and after awaits,
  // where state from the render that scheduled it is already stale.
  const idRef = useRef(item.id)
  /** What the database holds for this colour ('' before the add). */
  const savedRef = useRef(item.id ? item.hex : '')
  /** The newest pick not yet sent, or null. */
  const latestRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)
  /** Set by the trash on an unsaved row: nothing of it may reach the database now. */
  const abandonedRef = useRef(false)
  /** The row as it stands, for the add (name, note) and its follow-ups. */
  const itemRef = useRef(item)
  useEffect(() => {
    itemRef.current = item
  })

  /** Send the newest pick, if it is a real change. Returns once nothing is left to send. */
  async function pump(): Promise<void> {
    if (busyRef.current) return // an abandoned row never gets here: abandon() clears the timer and the pick
    const hex = latestRef.current
    latestRef.current = null
    if (hex === null || hex === savedRef.current) return
    busyRef.current = true
    let error: string | undefined
    try {
      if (item.slot) {
        const res = await setBrandColorSlotAction(artistId, item.slot, hex)
        error = res.error ?? (res.color ? undefined : 'Could not save that color.')
        if (res.color && res.color.id !== idRef.current) {
          idRef.current = res.color.id
          onPatch(item.key, { id: res.color.id })
        }
      } else if (idRef.current) {
        error = (await setBrandColorHexAction(artistId, idRef.current, hex)).error
      } else {
        const sent = itemRef.current
        const res = await addBrandColorAction(artistId, { name: sent.name, hex, note: sent.note || null })
        error = res.error ?? (res.color ? undefined : 'Could not add that color.')
        if (res.color) {
          idRef.current = res.color.id
          if (abandonedRef.current) {
            // Removed while its add was in flight: the manager threw this row away, so
            // the colour the add just made goes too. Nothing of it may be left behind.
            await deleteBrandColorAction(artistId, res.color.id)
            return
          }
          onPatch(item.key, { id: res.color.id })
          await followUp(res.color, sent)
        }
      }
    } catch {
      error = 'Could not save that color.'
    } finally {
      busyRef.current = false
    }
    if (error) {
      latestRef.current = null
      toast(error, 'error')
      onPatch(item.key, { hex: savedRef.current })
      return
    }
    savedRef.current = hex
    // A pick made while this was in flight: if its debounce is still running, the timer
    // sends it; if the timer already fired (and found us busy), send it now.
    if (latestRef.current !== null && !timerRef.current) await pump()
  }

  /** A title or note changed while the add was in flight: send it now the row exists. */
  async function followUp(color: BrandColor, sent: ColorItem) {
    const now = itemRef.current
    if (now.name !== sent.name) {
      const r = await renameBrandColorAction(artistId, color.id, now.name)
      if (r.error) toast(r.error, 'error')
    }
    if (now.note !== sent.note) {
      const r = await setBrandColorNoteAction(artistId, color.id, now.note || null)
      if (r.error) toast(r.error, 'error')
    }
  }

  function schedule(hex: string) {
    latestRef.current = hex
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void pump()
    }, SAVE_DELAY_MS)
  }

  // Leaving the page with a pick still in its debounce sends it rather than dropping it.
  useEffect(
    () => () => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
      void pump()
    },
    // pump reads only refs; binding it once is the point (the cleanup must run on unmount only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function onColor(raw: string) {
    const hex = canonicalHex(raw)
    if (!hex) return // the row variant never sends '', but a colour is always a hex here
    onPatch(item.key, { hex })
    schedule(hex)
  }

  async function rename(next: string) {
    if (!idRef.current) {
      onPatch(item.key, { name: next }) // carried by the add
      return
    }
    const res = await renameBrandColorAction(artistId, idRef.current, next)
    if (res.error) return { error: res.error }
    onPatch(item.key, { name: next })
  }

  async function saveNote(next: string) {
    if (!idRef.current) {
      onPatch(item.key, { note: next }) // carried by the add
      return
    }
    const res = await setBrandColorNoteAction(artistId, idRef.current, next || null)
    if (res.error) return { error: res.error }
    onPatch(item.key, { note: next })
  }

  // A built-in: fixed title and guide. An added colour: renamable, with its note.
  const words = item.slot
    ? { guide }
    : {
        onRename: rename,
        note: { value: item.note, onSave: saveNote, primaryRef: item.hex ? undefined : plusRef, autoFocus: item.fresh },
      }

  // An added colour's trash, in the row's end slot (so every row's swatch lines up).
  const remove = item.slot ? undefined : (
    <RowIcon
      icon="trash"
      label="Remove"
      tone="danger"
      onClick={() =>
        onRemove(item, {
          abandon: () => {
            abandonedRef.current = true
            latestRef.current = null
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = null
          },
        })
      }
    />
  )

  return (
    <LedgerRow title={item.name} {...words} remove={remove}>
      <ColorPalette
        variant="row"
        label={item.name}
        aria={item.name}
        value={item.hex}
        used={swatches}
        onChange={onColor}
        renderEmpty={(open) => (
          <>
            <span className="whitespace-nowrap text-[14px] text-ink-faint">No color yet</span>
            <RowIcon ref={plusRef} icon="plus" label="Add color" variant="primary" onClick={open} />
          </>
        )}
      />
      {item.hex ? <RowIcon icon="eye" label="Preview" onClick={() => onPreview(item.key)} /> : null}
    </LedgerRow>
  )
}
