'use client'

import { useState } from 'react'
import { useDebouncedFieldSave } from '../../../editor/use-debounced-field-save'
import { saveSeoFieldAction } from '../../../actions'
import { CopyButton } from '../copy-button'
import { Body, FieldBlock, GroupLabel, INPUT, SaveLine, SeeIt, TEXTAREA } from './rows'
import { cx } from '@/lib/cx'
import { FAQ_EXTRA, FAQ_KEYS } from '@/lib/site-content-schema'
import { PROBE_VERSION, probePrompts } from '@samfox1/site-bridge/seo'

export { PROBE_VERSION, probePrompts }

/**
 * Two halves. Ask the engines these five questions and note what they say (the
 * measurement). And answer them yourself: the answers publish to /faqsheet — a page the
 * site never links to, listed in the sitemap for crawlers and AI engines (Sam,
 * 2026-08-28: "I don't want users to stumble across this").
 */
export function AiSection({ artistId, name, schemaType, initial, auto }: { artistId: string; name: string; schemaType: string; initial: Record<string, string>; auto: string[] }) {
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
          <FieldBlock
            key={FAQ_KEYS[i]}
            label={`${i + 1} · ${p}`}
            // Questions 3–5 answer themselves from the tour, the catalog and the site
            // address, and keep updating; a written answer replaces that and stops
            // updating (Sam, 2026-08-28: "I don't want the manager to always update it").
            hint={
              (v[FAQ_KEYS[i]] ?? '').trim()
                ? i >= 2
                  ? 'your answer · replaces the automatic one, will not update itself'
                  : `${(v[FAQ_KEYS[i]] ?? '').length} characters`
                : auto[i]
                  ? i >= 2
                    ? 'automatic · updates itself'
                    : 'automatic · from the bio and facts'
                  : 'no answer yet'
            }
          >
            <div className="flex items-start gap-2">
              <textarea aria-label={`Answer ${i + 1}`} value={v[FAQ_KEYS[i]] ?? ''} placeholder={auto[i] || 'Nothing published to answer this yet'} onChange={(e) => set(FAQ_KEYS[i], e.target.value)} className={TEXTAREA} />
              <CopyButton text={p} label="Copy question" />
            </div>
          </FieldBlock>
        ))}
        <SaveLine status={save.status} />
      </Body>
      <GroupLabel>Your own questions</GroupLabel>
      <Body>
        {FAQ_EXTRA.map((e, i) => (
          <FieldBlock key={e.q} label={`Question ${i + 1}`}>
            <input aria-label={`Extra question ${i + 1}`} value={v[e.q] ?? ''} placeholder="A question people ask" onChange={(ev) => set(e.q, ev.target.value)} className={INPUT} />
            <textarea aria-label={`Extra answer ${i + 1}`} value={v[e.a] ?? ''} placeholder="The answer" onChange={(ev) => set(e.a, ev.target.value)} className={cx(TEXTAREA, 'mt-2 min-h-20')} />
          </FieldBlock>
        ))}
      </Body>
      <SeeIt>
        your answers publish to <span className="font-bold">/faqsheet</span>, a page visitors never see linked, that search and AI engines read. To measure: ask each question in ChatGPT, Perplexity, Google AI Mode and Copilot, signed out, and note whether the site is cited.
      </SeeIt>
    </div>
  )
}
