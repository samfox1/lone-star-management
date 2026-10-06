/**
 * "Fans sent by AI" on the Search page: the visitors an AI assistant sent to the site, by
 * assistant, from the analytics door's own sources (the door files chatgpt.com, perplexity.ai,
 * gemini.google.com … under `ai`: supabase/functions/event/derive.ts). An assistant answering
 * with a link to the site is the GEO half of the page working.
 *
 * Most first; the big three are always named, at zero when nobody came yet, so the list says
 * "none yet" rather than vanishing. An AI visit with no address the door kept is "Other AI".
 */
const ASSISTANT: Record<string, string> = {
  'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'openai.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity', 'gemini.google.com': 'Gemini', 'copilot.microsoft.com': 'Copilot',
  'claude.ai': 'Claude', 'you.com': 'You.com',
}
const ALWAYS = ['ChatGPT', 'Gemini', 'Perplexity']

export type AiVisit = { name: string; visitors: number }

export function aiVisits(rows: readonly { source: string; referrer_host: string; visitors: number }[]): AiVisit[] {
  const by = new Map<string, number>(ALWAYS.map((n) => [n, 0]))
  for (const r of rows) {
    if (r.source !== 'ai') continue
    const host = r.referrer_host.toLowerCase().replace(/^www\./, '')
    const name = ASSISTANT[host] ?? (host ? host : 'Other AI')
    by.set(name, (by.get(name) ?? 0) + r.visitors)
  }
  return [...by].map(([name, visitors]) => ({ name, visitors })).sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name))
}
