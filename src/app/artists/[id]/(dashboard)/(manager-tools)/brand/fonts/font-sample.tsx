'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { faceOf, fittedFontSize, SAMPLE_CAP_PX } from './face'

/**
 * The font's real capital height as a fraction of its font-size, measured from the ink of
 * an "H" once the face has loaded. null until then, and wherever there is no canvas (jsdom,
 * very old browsers) — fittedFontSize falls back to the plain size.
 */
function useCapRatio(family: string, googleFamily?: string | null): number | null {
  const [ratio, setRatio] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    const face = faceOf(family, googleFamily)
    const measure = () => {
      const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext?.('2d') : null
      if (!ctx) return
      ctx.font = `100px ${face}`
      const h = ctx.measureText('H').actualBoundingBoxAscent
      if (live && Number.isFinite(h) && h > 0) setRatio(h / 100)
    }
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (fonts?.load) fonts.load(`100px ${face}`).then(measure, measure)
    else measure()
    return () => {
      live = false
    }
  }, [family, googleFamily])
  return ratio
}

/** A font's name (or any text) drawn in that font, sized so its capitals match every
 *  other sample's. `cap` is the target capital height in px. `googleFamily` is set on a
 *  Google font, which is set in its real family (faceOf). */
export function FontSample({ family, googleFamily, cap = SAMPLE_CAP_PX, fallback = 16, className, children }: {
  family: string
  googleFamily?: string | null
  cap?: number
  fallback?: number
  className?: string
  children: ReactNode
}) {
  const size = fittedFontSize(useCapRatio(family, googleFamily), cap, fallback)
  return (
    <span data-font-sample="" style={{ fontFamily: faceOf(family, googleFamily), fontSize: `${size}px` }} className={cx(className)}>
      {children}
    </span>
  )
}

/** For elements that must stay themselves (the preview's contentEditable): the style only. */
export function useSampleStyle(family: string, cap = SAMPLE_CAP_PX, fallback = 16, googleFamily?: string | null) {
  const size = fittedFontSize(useCapRatio(family, googleFamily), cap, fallback)
  return { fontFamily: faceOf(family, googleFamily), fontSize: `${size}px` }
}
