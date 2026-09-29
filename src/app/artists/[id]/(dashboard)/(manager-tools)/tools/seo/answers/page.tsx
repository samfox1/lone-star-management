import { loadAnswers, loadSeoBase } from '../load'
import { AnswersTab } from './answers-tab'

/**
 * ANSWERS: the questions fans ask AI about the artist, and the answers the site gives on its
 * fact sheet (round 2 mock). The automatic answers are built from the DRAFT data the manager
 * sees (load.ts `loadAnswers`), so what they publish is what the site answers with.
 */
export default async function SeoAnswersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const { auto, initial } = await loadAnswers(base)
  return <AnswersTab artistId={id} name={base.artist.name} schemaType={base.schemaType} initial={initial} auto={auto} />
}
