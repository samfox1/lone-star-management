import { defaultSeoTitle } from '@samfox1/site-bridge/seo'

/** What defaultTitleOf reads: the facts the SEO tabs load (tools/seo/load.ts loadSeoBase). */
export type TitleFacts = {
  artist: { name: string }
  genre: string | null
  location: string | null
  schemaType: 'MusicGroup' | 'Person'
}

/** The title the site composes when the manager's is blank (audit #1), from the same facts. */
export function defaultTitleOf(b: TitleFacts): string {
  return defaultSeoTitle({ name: b.artist.name, genre: b.genre, location: b.location, schema_type: b.schemaType })
}
