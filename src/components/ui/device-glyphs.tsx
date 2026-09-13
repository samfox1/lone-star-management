import type { ReactNode } from 'react'
import { SourceGlyph } from '@/components/ui/source-glyphs'

/**
 * Monochrome marks for what a visit was read on: the device on the left, the
 * browser (or the app whose in-app browser it was) on the right. 24×24 grid,
 * strokes at 1.8 so they sit at the same weight as the source marks.
 */
const DEVICES: Record<string, ReactNode> = {
  mobile: (
    <>
      <rect x="7.1" y="2.5" width="9.8" height="19" rx="2.7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.6 5.6 h2.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="18.4" r="0.95" fill="currentColor" />
    </>
  ),
  tablet: (
    <>
      <rect x="4.5" y="3" width="15" height="18" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="18.2" r="0.95" fill="currentColor" />
    </>
  ),
  desktop: (
    <>
      <rect x="4.1" y="4.6" width="15.8" height="10.8" rx="1.9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2.1 18.7 h19.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
}

const BROWSERS: Record<string, ReactNode> = {
  chrome: (
    <>
      <circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 16.1 V21.3 M8.45 9.95 L3.95 7.35 M15.55 9.95 L20.05 7.35" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  safari: (
    <>
      <circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16.4 7.6 L13.5 13.5 L7.6 16.4 L10.5 10.5 Z" fill="currentColor" />
    </>
  ),
  firefox: (
    <>
      <path d="M12 2.9 a9.1 9.1 0 1 0 9.1 9.1 c0 -1.6 -0.4 -3 -1.1 -4.3 c0.2 1.3 -0.2 2.4 -0.9 3 c0.1 -2.4 -1.2 -4.5 -3.2 -5.6 c1 1.3 1.3 2.8 0.9 4.1 a4.6 4.6 0 0 0 -8.9 1.4 c-0.8 -0.7 -1.1 -1.9 -0.8 -3.1 C5.7 8.6 5 10.4 5 12.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  edge: (
    <path d="M20.6 16.9 a9.3 9.3 0 1 1 0.7 -6.6 H11.7 a4.4 4.4 0 0 0 -1.2 8.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  opera: (
    <>
      <ellipse cx="12" cy="12" rx="8.6" ry="9.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <ellipse cx="12" cy="12" rx="3.6" ry="6.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  samsung: (
    <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">S</text>
  ),
}

/** In-app browsers reuse the platform's own mark, so Instagram looks like Instagram everywhere. */
const IN_APP = new Set(['instagram', 'tiktok', 'facebook', 'x'])

const FALLBACK = (
  <>
    <circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M2.7 12 h18.6 M12 2.7 c3.2 3.1 3.2 15.5 0 18.6 M12 2.7 c-3.2 3.1 -3.2 15.5 0 18.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </>
)

export function DeviceGlyph({ device, size = 19, className }: { device: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      {DEVICES[device] ?? FALLBACK}
    </svg>
  )
}

export function BrowserGlyph({ browser, size = 17, className }: { browser: string; size?: number; className?: string }) {
  if (IN_APP.has(browser)) return <SourceGlyph source={browser} size={size} className={className} />
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      {BROWSERS[browser] ?? FALLBACK}
    </svg>
  )
}

export const DEVICE_LABEL: Record<string, string> = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop' }
export const BROWSER_LABEL: Record<string, string> = {
  chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', opera: 'Opera', samsung: 'Samsung',
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X',
}
export const browserLabel = (b: string) => BROWSER_LABEL[b] ?? (b ? b[0].toUpperCase() + b.slice(1) : 'Unknown')
