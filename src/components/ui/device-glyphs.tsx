import type { ReactNode } from 'react'

/**
 * Monochrome marks for what a visit was read on: a phone, a tablet, a computer.
 * 24×24 grid, strokes at 1.8 so they sit at the same weight as the source marks.
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

/** Anything the door could not classify: a plain globe. */
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
