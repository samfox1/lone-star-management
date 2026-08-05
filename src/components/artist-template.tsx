/**
 * Picks the public-site template for an artist from their saved `template`
 * choice. Both templates render the same SiteData, so any artist can use any
 * template. Used by the public page (/[slug]) and the manager preview.
 */
import type { SiteData } from '@/lib/site'
import { ArtistSite } from '@/components/artist-site'
import { CinematicTemplate } from '@/components/templates/cinematic'
import { fontStyleCss } from '@/lib/fonts'

export const TEMPLATES = [
  { value: 'classic', label: 'Classic — clean light layout' },
  { value: 'cinematic', label: 'Cinematic — dark, video hero' },
] as const

/** `editable` turns on EDIT MODE: templates emit the `data-lse-*` markers (see
 *  `lib/site-editor`) so the visual editor's frame can select regions. Off by
 *  default — the public site and the read-only preview carry no markers. Only the
 *  cinematic template is instrumented so far (classic follows in a later phase). */
export function ArtistTemplate({ data, editable = false }: { data: SiteData; editable?: boolean }) {
  // Custom fonts ride HERE, the one place both templates and every render mode (public
  // page, preview, edit frame) pass through — inject anywhere lower and one mode
  // silently loses its fonts. fontStyleCss is the sanitizing gate: everything in the
  // emitted block is allowlisted or dropped, so this dangerouslySetInnerHTML carries
  // nothing a manager typed. Legacy payloads have neither key (`?? []` / `?? {}`).
  const fontCss = fontStyleCss(data.fonts ?? [], data.font_slots ?? {})
  const body =
    data.artist.template === 'cinematic' ? (
      <CinematicTemplate data={data} editable={editable} />
    ) : (
      <ArtistSite data={data} />
    )
  return (
    <>
      {fontCss && <style dangerouslySetInnerHTML={{ __html: fontCss }} />}
      {body}
    </>
  )
}
