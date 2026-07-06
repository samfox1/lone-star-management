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

const PATHS: Record<IconName, React.ReactNode> = {
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
  merch: (
    <>
      <path d="M6 8h12l-1 12H7L6 8z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
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
