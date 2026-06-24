/**
 * Picks the public-site template for an artist from their saved `template`
 * choice. Both templates render the same SiteData, so any artist can use any
 * template. Used by the public page (/[slug]) and the manager preview.
 */
import type { SiteData } from '@/lib/site'
import { ArtistSite } from '@/components/artist-site'
import { CinematicTemplate } from '@/components/templates/cinematic'

export const TEMPLATES = [
  { value: 'classic', label: 'Classic — clean light layout' },
  { value: 'cinematic', label: 'Cinematic — dark, video hero' },
] as const

export function ArtistTemplate({ data }: { data: SiteData }) {
  if (data.artist.template === 'cinematic') return <CinematicTemplate data={data} />
  return <ArtistSite data={data} />
}
