import type { SVGProps } from 'react'

/**
 * Icon set for the redesigned manager surface — thin stroked line icons,
 * matching the prototype. Stroke uses `currentColor`, so set the colour with a
 * text-* utility on the icon or its parent.
 */
export type IconName =
  | 'roster'
  | 'analytics'
  | 'tracks'
  | 'releases'
  | 'tour'
  | 'videos'
  | 'merch'
  | 'links'
  | 'site'
  | 'epk'
  | 'integrations'
  | 'search'
  | 'settings'
  | 'plus'
  | 'chevronRight'
  | 'chevronLeft'
  | 'edit'
  | 'external'
  | 'grid'
  | 'list'
  | 'download'
  | 'upload'
  | 'alert'
  | 'refresh'
  | 'ticket'
  | 'bolt'
  | 'check'
  | 'tools'
  | 'more'
  | 'share'
  | 'trash'
  | 'folder'
  | 'photo'
  | 'text'
  | 'note'
  | 'grip'
  | 'minus'
  | 'close'
  | 'play'
  | 'pause'
  | 'replay'
  | 'brush'

const PATHS: Record<IconName, React.ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2.2 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  photo: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17.5l4.5-4.5 3 3 3.5-3.5 4 4" />
    </>
  ),
  roster: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.8" />
      <path d="M16.5 14c2.5.3 4.5 2.3 4.5 5" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V4M20 20H4" />
      <path d="M8 16l3-4 3 2 4-6" />
    </>
  ),
  tracks: (
    <>
      <path d="M9 18V5l11-2v11" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  releases: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="2.2" />
    </>
  ),
  tour: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16M8 3v4M16 3v4" />
    </>
  ),
  videos: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M10 9.5l4.5 2.5L10 14.5z" fill="currentColor" stroke="none" />
    </>
  ),
  // A real shopping bag — the old trapezoid read as anything but (Sam, 2026-08-12).
  merch: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  links: (
    <>
      <path d="M9 15l6-6" />
      <path d="M10.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </>
  ),
  site: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
    </>
  ),
  epk: (
    <>
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4M9.5 13h5M9.5 16.5h5" />
    </>
  ),
  integrations: (
    <>
      <path d="M9 15l6-6" />
      <path d="M10.5 7.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" />
      <path d="M13.5 16.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  edit: <path d="M14 6l4 4M4 20l1-4.5L16 4.5a1.5 1.5 0 0 1 3 3L8 19l-4.5 1z" />,
  external: <path d="M7 17L17 7M9 7h8v8" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  upload: <path d="M12 21V9M7 14l5-5 5 5M5 3h14" />,
  alert: (
    <>
      <path d="M12 4.5 20.5 19.5H3.5z" />
      <path d="M12 10.5v4" />
      <path d="M12 17.4h.01" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" />
      <path d="M14 6.5v11" strokeDasharray="1.5 2.2" />
    </>
  ),
  bolt: <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" />,
  check: <path d="M5 12.5l4.5 4.5L19 6.5" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.5M4 4v3.5h3.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.5M20 20v-3.5h-3.5" />
    </>
  ),
  tools: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  more: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="17" cy="6" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <path d="M8.1 10.9l6.8-3.8M8.1 13.1l6.8 3.8" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13" />,
  // "Aa" rather than bare lines (Sam, 2026-08-12) — real glyphs say "type" at a glance
  // where rules read as layout. Drawn as text, not paths: the letterforms come from the
  // UI font, so they match the app instead of a hand-traced approximation.
  text: (
    <text
      x="12"
      y="16.5"
      textAnchor="middle"
      fontSize="13"
      fontWeight="700"
      fontFamily="var(--font-inter, 'Inter'), system-ui, sans-serif"
      fill="currentColor"
      stroke="none"
    >
      Aa
    </text>
  ),
  // A page with a folded corner and a couple of written lines — enquiries are notes
  // somebody wrote, and `text` (bare lines) reads as formatting rather than a message.
  note: (
    <>
      <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v5h5" />
      <path d="M8 13h8M8 16.5h5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <path d="M8.5 5.5v13" strokeWidth={2.4} />
      <path d="M15.5 5.5v13" strokeWidth={2.4} />
    </>
  ),
  replay: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 21H3v-5" />
    </>
  ),
  brush: (
    <>
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
}

export function Icon({
  name,
  size = 18,
  className,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
