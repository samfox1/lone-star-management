'use client'

import { useState } from 'react'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { saveSeoFieldAction } from '../../../actions'
import { CopyButton } from '../copy-button'
import { Body, FieldBlock, GroupLabel, SaveLine, SeeIt, TEXTAREA } from './rows'
import { FAQ_KEYS } from '@/lib/site-content-schema'
import { PROBE_VERSION, probePrompts } from '@samfox1/site-bridge/seo'

export { PROBE_VERSION, probePrompts }

/**
 * Two halves. Ask the engines these five questions and note what they say (the
 * measurement). And answer them yourself: the answers publish to /faqsheet — a page the
 * site never links to, listed in the sitemap for crawlers and AI engines (Sam,
 * 2026-08-28: "I don't want users to stumble across this").
 */
export function AiSection({ artistId, name, schemaType, initial }: { artistId: string; name: string; schemaType: string; initial: Record<string, string> }) {
  const [v, setV] = useState(initial)
  const save = useDebouncedFieldSave<string>({ persist: (k, val) => saveSeoFieldAction(artistId, k, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const set = (k: string, val: string) => {
    setV((s) => ({ ...s, [k]: val }))
    save.save(k, val)
  }
  const prompts = probePrompts(name, schemaType)
  return (
    <div>
      <GroupLabel>The five questions · {PROBE_VERSION}</GroupLabel>
      <Body>
        {prompts.map((p, i) => (
          <FieldBlock key={FAQ_KEYS[i]} label={`${i + 1} · ${p}`} hint={(v[FAQ_KEYS[i]] ?? '').length ? `${(v[FAQ_KEYS[i]] ?? '').length} characters` : 'unanswered'}>
            <div className="flex items-start gap-2">
              <textarea aria-label={`Answer ${i + 1}`} value={v[FAQ_KEYS[i]] ?? ''} placeholder="Your answer, in the artist's words" onChange={(e) => set(FAQ_KEYS[i], e.target.value)} className={TEXTAREA} />
              <CopyButton text={p} label="Copy question" />
            </div>
          </FieldBlock>
        ))}
        <SaveLine status={save.status} />
      </Body>
      <SeeIt>
        your answers publish to <span className="font-bold">/faqsheet</span>, a page visitors never see linked, that search and AI engines read. To measure: ask each question in ChatGPT, Perplexity, Google AI Mode and Copilot, signed out, and note whether the site is cited.
      </SeeIt>
    </div>
  )
}
