'use client'

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { HEAT_R } from '@/lib/map-constants'
import type { CountryFocus } from '@/lib/analytics-map'
import { nearestPoint, type Point, type View } from '@/lib/map-view'

/** A drag shorter than this, in screen px, is a click. */
export const CLICK_PX = 4
/** How near the pointer must be to a major city's dot to read it, in screen px: the glow's own reach. */
export const REACH_PX = HEAT_R

/** A dot the pointer can read: a major city, where the view draws it. */
export type CityDot = Point & { key: string; name: string; region: string; visitors: number; views: number }
export type Hover<D extends CityDot = CityDot> = { kind: 'city'; dot: D } | { kind: 'country'; focus: CountryFocus; at: Point }

type Options<D extends CityDot> = {
  /** What the svg shows, in drawing units: the flat map's window, or the globe's whole frame. */
  frame: View
  countries: CountryFocus[]
  /** The country in focus, owned above. */
  country: string | null
  /** The dots the pointer reads inside a country, in drawing units. */
  dots: D[]
  onSelectCountry: (code: string) => void
  /** The country changed above: re-aim the view. Runs during render, React's pattern for state that follows a prop. */
  onCountryChange: (code: string | null) => void
  /** One step of a drag: how far the pointer moved in screen px, and the svg's drawn size. */
  onDrag: (dx: number, dy: number, rect: DOMRect) => void
  /** A pinch or ctrl + scroll: the zoom factor, and the drawing point under the pointer. */
  onPinch: (factor: number, at: Point) => void
}

const codeAt = (target: EventTarget | null) => (target as Element | null)?.closest?.('[data-country]')?.getAttribute('data-country') ?? null

function toDrawing(frame: View, clientX: number, clientY: number, rect: DOMRect): Point | null {
  if (rect.width === 0 || rect.height === 0) return null
  return { x: frame.x + ((clientX - rect.left) / rect.width) * frame.w, y: frame.y + ((clientY - rect.top) / rect.height) * frame.h }
}

/**
 * The pointer on a map or a globe, which behave alike: drag to move, pinch to zoom, click a country
 * with an audience to choose it, and a readout for what is under the pointer — the COUNTRY at the
 * country level, the nearest MAJOR CITY inside one, within REACH_PX on screen. The view owns what a
 * drag, a pinch or a new country does to it.
 */
export function useMapPointer<D extends CityDot>(opts: Options<D>) {
  const { frame, countries, country, dots, onSelectCountry, onCountryChange, onDrag } = opts
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Hover<D> | null>(null)
  /** Drives the cursor only; the drag itself is the ref below (AGENTS.md rule 5). */
  const [dragging, setDragging] = useState(false)
  /** The drag in progress, in client px, and the country it STARTED on. */
  const drag = useRef<{ x: number; y: number; x0: number; y0: number; code: string | null } | null>(null)

  const [seenCountry, setSeenCountry] = useState(country)
  if (country !== seenCountry) {
    setSeenCountry(country)
    setHover(null)
    onCountryChange(country)
  }

  // Pinch / ctrl + scroll zooms. Registered by hand, once: React's wheel handler is passive and cannot
  // keep the browser from zooming the page. The latest frame and handler come through a ref.
  const latest = useRef({ frame, onPinch: opts.onPinch })
  useEffect(() => {
    latest.current = { frame, onPinch: opts.onPinch }
  })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const at = toDrawing(latest.current.frame, e.clientX, e.clientY, el.getBoundingClientRect())
      if (at) latest.current.onPinch(Math.exp(-e.deltaY / 200), at)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const svgProps = {
    ref: svgRef,
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      drag.current = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, code: codeAt(e.target) }
      setDragging(true)
      // Capture sends every later event of this pointer to the svg, the pointer-up included. So the
      // country a click chooses is read HERE: read off the pointer-up, it was always the svg, and a
      // click on the real map chose nothing.
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const d = drag.current
      if (d) {
        drag.current = { ...d, x: e.clientX, y: e.clientY }
        if (rect.width > 0 && rect.height > 0) onDrag(e.clientX - d.x, e.clientY - d.y, rect)
        setHover(null)
        return
      }
      const at = toDrawing(frame, e.clientX, e.clientY, rect)
      if (!at) {
        setHover(null)
        return
      }
      if (country === null) {
        const code = codeAt(e.target)
        const focus = code ? countries.find((c) => c.code === code) : undefined
        setHover(focus ? { kind: 'country', focus, at } : null)
        return
      }
      const dot = nearestPoint(dots, at, (REACH_PX * frame.w) / rect.width)
      setHover(dot ? { kind: 'city', dot } : null)
    },
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      const d = drag.current
      drag.current = null
      setDragging(false)
      if (!d?.code || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= CLICK_PX) return
      const code = d.code
      if (countries.some((c) => c.code === code)) onSelectCountry(code)
    },
    onPointerCancel: () => {
      drag.current = null
      setDragging(false)
    },
  }

  return { svgProps, hover, dragging, clearHover: () => setHover(null) }
}
