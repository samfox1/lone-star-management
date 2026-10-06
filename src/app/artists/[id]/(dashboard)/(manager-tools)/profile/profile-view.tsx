'use client'

import { useRef, useState, type ReactNode } from 'react'
import { FACT_CONTENT_KEYS, MAX_ALIASES, MAX_ALIAS_LENGTH, countryOf } from '@samfox1/site-bridge/seo'
import { SAVE_FAILED } from '@/lib/manager-tools/format'
import { genreError } from '@/lib/artist-facts'
import { COUNTRY_OPTIONS, GENRE_MAX, SCHEMA_TYPES, artistNameError, type SchemaType } from '@/lib/manager-tools/profile/profile'
import { cityError, cleanFactValue, factErrors, joinAliases, readFacts, thisYearAt, type FactField } from '@/lib/seo-facts'
import { regionIn, regionsFor } from '@/lib/seo-regions'
import { useDebouncedFieldSave } from '../../editor/use-debounced-field-save'
import { saveArtistFactAction, saveSeoFieldAction } from '../../actions'
import { LedgerRow, LedgerSection } from '../_ui/ledger'
import { EYEBROW } from '../_ui/styles'
import { EndSlot, LineField } from '../_ui/fields'
import { EditList } from '../_ui/edit-list'
import { FieldError } from '../_ui/field-error'
import { saveArtistNameAction } from './actions'
import { BioRow } from './bio-row'
import { ChoiceMenu } from '../_ui/choice-menu'

export type ProfileViewProps = {
  artistId: string
  artistName: string
  schemaType: SchemaType
  genre: string
  city: string
  /** The four fact keys as stored (fact_region, fact_country, fact_aliases, fact_active_since). */
  facts: Record<string, string>
  bio: string
  /** Tapir's own floor for a bio, in WORDS (lib/seo-tests who.ts BIO_MIN_WORDS): the bio test
   *  also asks that it name the genre, the city and a release or show. Shown while editing. */
  bioMinWords: number
  /** "N outside bios may be out of date" under the Bio row, or '' (outsideBiosNudge). */
  bioNudge?: string
  /** The Profile photo row, first under Who (photo-row.tsx). A slot, so the page can render it
   *  on the server with its own reads. */
  photo?: ReactNode
}

/**
 * PROFILE (Sam, 2026-10-02, PROFILE_TOOL_PLAN.md; prototypes/profile_tool_20261001.html): one home
 * for who the artist is, in Brand's ledger. Who (the photo, the name, the bio, the type, genre,
 * other names, the year they started) and Where (city · region · country). Moved here from the
 * SEO / GEO Facts tab and Settings › General (the name), with the same saves.
 *
 * Every value is checked by the SAME rules the save gate applies (lib/seo-facts.ts
 * `cleanFactValue` and the city's `cityError`, lib/artist-facts.ts `genreError`, the name's
 * `artistNameError`) before it is sent: a refusal shows under its row in those words and is never
 * sent. Rows autosave to the draft; the page's Publish bar ships them (_ui/site-pending.tsx).
 */
export function ProfileView(p: ProfileViewProps) {
  const { artistId } = p
  const [name, setName] = useState(p.artistName)
  const [type, setType] = useState<SchemaType>(p.schemaType)
  const [genre, setGenre] = useState(p.genre)
  const [city, setCity] = useState(p.city)
  const [facts, setFacts] = useState(p.facts)
  const [errors, setErrors] = useState<Partial<Record<'name' | 'type' | 'genre' | 'city' | FactField, string>>>(() =>
    factErrors(p.facts, { name: p.artistName, location: p.city, schema_type: p.schemaType }, thisYearAt(new Date())),
  )
  const refuse = (k: keyof typeof errors, msg: string | null) => setErrors((e) => ({ ...e, [k]: msg ?? undefined }))
  /** The name the fact rules judge against (another name may not be the artist's own): the
   *  saved one, never one still refused. */
  const artistName = artistNameError(name) ? p.artistName : name.trim()

  const view = readFacts(facts, { name: artistName, location: city, schema_type: type })

  /* ── saving ── */
  const nameSave = useDebouncedFieldSave<string>({
    persist: async (_k, val) => {
      const r = await saveArtistNameAction(artistId, val)
      refuse('name', r.error ?? null)
      return r
    },
    // The name's rule, before anything is queued: a blank or too-long name is never sent.
    normalize: (val) => (artistNameError(val) ? null : val),
  })
  const seoSave = useDebouncedFieldSave<string>({
    persist: async (key, val) => {
      const field = (Object.keys(FACT_CONTENT_KEYS) as FactField[]).find((f) => FACT_CONTENT_KEYS[f] === key)
      const r = await saveSeoFieldAction(artistId, key, val)
      if (field) refuse(field, r.ok ? null : (r.error ?? SAVE_FAILED))
      return { ok: r.ok, error: r.error }
    },
    // The gate's rule, before anything is queued: a refused value is never sent, and it
    // cancels a still-pending older one for the same key.
    normalize: (val, key) => {
      const field = (Object.keys(FACT_CONTENT_KEYS) as FactField[]).find((f) => FACT_CONTENT_KEYS[f] === key)
      if (!field) return val
      return 'error' in cleanFactValue(FACT_CONTENT_KEYS[field], val, { artistName, thisYear: thisYearAt(new Date()) }) ? null : val
    },
  })
  const artistSave = useDebouncedFieldSave<string>({
    persist: async (col, val) => {
      const r = await saveArtistFactAction(artistId, col as 'genre' | 'location' | 'schema_type', val)
      refuse(col === 'location' ? 'city' : (col as 'genre'), r.ok ? null : (r.error ?? SAVE_FAILED))
      return { ok: r.ok, error: r.error }
    },
    // The city's rule (the same as its region and country): a refused city is never sent.
    normalize: (val, col) => (col === 'location' && cityError(val) ? null : val),
  })

  const setNameValue = (raw: string) => {
    setName(raw)
    refuse('name', artistNameError(raw))
    nameSave.save('name', raw)
  }

  /** A fact through its rule first: the gate's words shown and nothing sent, or queued. */
  const setFact = (field: FactField, raw: string) => {
    const key = FACT_CONTENT_KEYS[field]
    setFacts((f) => ({ ...f, [key]: raw }))
    const r = cleanFactValue(key, raw, { artistName, thisYear: thisYearAt(new Date()) })
    refuse(field, 'error' in r ? r.error : null)
    seoSave.save(key, raw)
  }

  const setCityValue = (raw: string) => {
    setCity(raw)
    refuse('city', cityError(raw))
    artistSave.save('location', raw)
  }

  /* ── genre and other names: click-to-edit lists (_ui/edit-list.tsx, Sam 2026-10-05) ──
     Each check runs on the WHOLE list the edit would make, before anything is sent: a refusal
     is a toast in the rule's own words and the field keeps what was typed. An item edited to
     nothing leaves the list. */
  const genres = genre
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const genreProblem = (next: readonly string[]): string | null => genreError(next.join(', '))
  const saveGenres = (next: readonly string[]) => {
    const joined = next.filter(Boolean).join(', ')
    refuse('genre', null)
    setGenre(joined)
    artistSave.runNow('genre', async () => {
      const r = await saveArtistFactAction(artistId, 'genre', joined)
      refuse('genre', r.ok ? null : (r.error ?? SAVE_FAILED))
      return r
    })
  }

  const aliases = (facts[FACT_CONTENT_KEYS.aliases] ?? '').split(/\r\n?|\n/).map((a) => a.trim()).filter(Boolean)
  const aliasProblem = (next: readonly string[]): string | null => {
    const r = cleanFactValue(FACT_CONTENT_KEYS.aliases, joinAliases(next), { artistName, thisYear: thisYearAt(new Date()) })
    return 'error' in r ? r.error : null
  }
  const saveAliases = (next: readonly string[]) => setFact('aliases', joinAliases(next))

  const changeType = (next: string) => {
    if (next !== 'MusicGroup' && next !== 'Person') return
    setType(next)
    artistSave.runNow('schema_type', async () => {
      const r = await saveArtistFactAction(artistId, 'schema_type', next)
      refuse('type', r.ok ? null : (r.error ?? SAVE_FAILED))
      return r
    })
  }

  /* ── where: the country and (for the countries that have one) the region are PICKS ── */
  const country = facts[FACT_CONTENT_KEYS.country] ?? ''
  const region = facts[FACT_CONTENT_KEYS.region] ?? ''
  const regionList = regionsFor(country)
  /** Country and region picks are written IN ORDER: the gate judges a region against the
   *  country it reads back, so a region picked right after a country must not land first. */
  const placeQueue = useRef<Promise<unknown>>(Promise.resolve())
  const writePlace = (field: 'country' | 'region', value: string) => {
    const key = FACT_CONTENT_KEYS[field]
    setFacts((f) => ({ ...f, [key]: value }))
    refuse(field, null)
    placeQueue.current = placeQueue.current.then(async () => {
      const r = await saveSeoFieldAction(artistId, key, value).catch(() => ({ ok: false, error: SAVE_FAILED }))
      if (!r.ok) refuse(field, r.error ?? SAVE_FAILED)
    })
  }
  const pickCountry = (next: string) => {
    writePlace('country', next)
    // A region that isn't on the new country's list goes with the old country; one typed for
    // a country without a list stays (it may still be right, and it is text anyway).
    const list = regionsFor(next)
    if (region && list && !regionIn(list, region)) writePlace('region', '')
  }
  const pickRegion = (next: string) => writePlace('region', next)

  const person = type === 'Person'

  return (
    <div>
      <LedgerSection label="Who">
        {p.photo}
        <LedgerRow title="Name">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <LineField label="Name" value={name} placeholder="—" invalid={!!errors.name} onChange={setNameValue} className="w-[160px] min-[900px]:text-right" />
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
        <BioRow artistId={artistId} bio={p.bio} minWords={p.bioMinWords} nudge={p.bioNudge} />
        <LedgerRow title="Type">
          <ChoiceMenu label="Type" value={type} options={SCHEMA_TYPES} onChange={changeType} />
          <EndSlot />
        </LedgerRow>
        {errors.type ? <FieldError>{errors.type}</FieldError> : null}
        <LedgerRow title="Genre" guide="Search, AI answers and outside bios.">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <EditList
              items={genres}
              text={(g) => g}
              label="Genre"
              addLabel="Add genre"
              placeholder="Genre"
              maxLength={GENRE_MAX}
              validate={(v, i) => genreProblem(withItem(genres, i, v))}
              onSave={(i, v) => saveGenres(withItem(genres, i, v))}
              onAdd={(v) => saveGenres([...genres, v])}
              onRemove={(i) => saveGenres(genres.filter((_, j) => j !== i))}
              removeLabel={(g) => `Remove ${g}`}
              className="justify-start min-[900px]:justify-end"
            />
            {errors.genre ? <FieldError>{errors.genre}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
        <LedgerRow title="Other names" guide="Other spellings people search.">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <EditList
              items={aliases}
              text={(a) => a}
              label="Other name"
              addLabel="Add name"
              placeholder="Name"
              maxLength={MAX_ALIAS_LENGTH}
              validate={(v, i) => aliasProblem(withItem(aliases, i, v))}
              onSave={(i, v) => saveAliases(withItem(aliases, i, v))}
              // No + once the list is full (the gate's MAX_ALIASES).
              onAdd={aliases.length < MAX_ALIASES ? (v) => saveAliases([...aliases, v]) : undefined}
              onRemove={(i) => saveAliases(aliases.filter((_, j) => j !== i))}
              removeLabel={(a) => `Remove ${a}`}
              className="justify-start min-[900px]:justify-end"
            />
            {errors.aliases ? <FieldError>{errors.aliases}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
        <LedgerRow title="Started" guide="The year you began." meta={person ? 'Not shown to search engines for a visual artist' : undefined}>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <LineField
              label="Started"
              value={facts[FACT_CONTENT_KEYS.activeSince] ?? ''}
              placeholder="Year"
              inputMode="numeric"
              invalid={!!errors.activeSince}
              onChange={(v) => setFact('activeSince', v)}
              className="w-[72px] min-[900px]:text-right"
            />
            {errors.activeSince ? <FieldError>{errors.activeSince}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Where">
        <LedgerRow title="Based in" guide="Region and country stop a mix-up." meta={view.region || view.country ? view.place : undefined}>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <div className="grid grid-cols-[minmax(0,auto)_minmax(0,auto)_minmax(0,auto)] gap-7">
              <Cell label="City">
                <LineField label="City" value={city} placeholder="—" invalid={!!errors.city} onChange={setCityValue} className="w-[120px]" />
              </Cell>
              <Cell label="Region">
                {regionList ? (
                  <ChoiceMenu
                    label="Region"
                    value={region}
                    options={[{ value: '', label: '—' }, ...regionList.names.map((n) => ({ value: n, label: n }))]}
                    align="end"
                    size="cell"
                    onChange={pickRegion}
                  />
                ) : (
                  <LineField label="Region" value={region} placeholder="—" invalid={!!errors.region} onChange={(v) => setFact('region', v)} className="w-[110px]" />
                )}
              </Cell>
              <Cell label="Country">
                {/* A country stored in another spelling ("USA") is shown back as the table has it. */}
                <ChoiceMenu label="Country" value={countryOf(country)?.name ?? country} options={COUNTRY_OPTIONS} align="end" size="cell" onChange={pickCountry} />
              </Cell>
            </div>
            {errors.city ? <FieldError>{errors.city}</FieldError> : null}
            {errors.region ? <FieldError>{errors.region}</FieldError> : null}
            {errors.country ? <FieldError>{errors.country}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
      </LedgerSection>
    </div>
  )
}

/** A small labelled cell (city · region · country), modal-kit's KvCells look. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span aria-hidden="true" className={EYEBROW}>
        {label}
      </span>
      {children}
    </div>
  )
}

/** The list with item `index` replaced by `value` (or `value` added at the end, for null). An
 *  emptied item drops out. */
function withItem(list: readonly string[], index: number | null, value: string): string[] {
  const next = index === null ? [...list, value] : list.map((x, j) => (j === index ? value : x))
  return next.filter(Boolean)
}
