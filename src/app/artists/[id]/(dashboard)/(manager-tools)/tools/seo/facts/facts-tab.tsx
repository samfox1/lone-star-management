'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ABOUT_PLACEMENTS, FACT_CONTENT_KEYS, MAX_ALIASES, type AboutPlacement } from '@samfox1/site-bridge/seo'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { CITY_MAX_LENGTH, cleanFactValue, factErrors, factTextError, joinAliases, readFacts, thisYearAt, type FactField } from '@/lib/seo-facts'
import { isTooLong, TEXT_LIMITS } from '@/lib/site-editor/text-limits'
import { useDebouncedFieldSave } from '../../../../editor/use-debounced-field-save'
import { TextLimitHint } from '../../../../editor/inspector-shared'
import { saveArtistFactAction, saveEditorFieldAction, saveSeoFieldAction } from '../../../../actions'
import { CardModal } from '../../../../card-modal'
import { KvRow, MetaDot, ModalHeader, SelectMenu } from '../../../../modal-kit'
import { LedgerRow, LedgerSection } from '../../../_ui/ledger'
import { RowIcon } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { AreaField, Chips, EndSlot, FieldError, IconLink, LineField } from '../_ui/parts'
import { PlatformMark } from '../_ui/mark'
import { clearHash, useOpenOnHash } from '../_ui/hash'

/** Musician = MusicGroup, Visual artist = Person: the app's one wording (site-tools.tsx). */
const TYPES = [
  { value: 'MusicGroup', label: 'Musician' },
  { value: 'Person', label: 'Visual artist' },
] as const
type SchemaType = (typeof TYPES)[number]['value']

const PLACEMENT: Record<AboutPlacement, string> = { home: 'On the homepage', page: 'Its own page', hidden: 'Hidden from visitors' }

/** The genre column's cap (lib/artist-facts.ts `artistFactUpdate`). */
const GENRE_MAX = 120

export type ProfileLink = { slug: string; label: string; display: string; inFactCard: boolean }

export type FactsTabProps = {
  artistId: string
  artistName: string
  schemaType: SchemaType
  genre: string
  city: string
  /** The four fact keys as stored (fact_region, fact_country, fact_aliases, fact_active_since). */
  facts: Record<string, string>
  bio: string
  /** Tapir's own bio goal (lib/seo-tests who.ts BIO_GOAL): the Test tab's number. */
  bioGoal: number
  about: { placement: string; heading: string }
  bookingEmail: string
  /** The artist's connected profiles, fact databases (MusicBrainz, Discogs, Wikidata) apart. */
  profiles: ProfileLink[]
  /** The fact databases that are connected, by slug, as shown. */
  databases: Partial<Record<'musicbrainz' | 'discogs' | 'wikidata', string>>
  /** MusicBrainz's own artist editor, filled in (connections/services/musicbrainz/seed.ts). */
  musicBrainzCreate: string
}

/**
 * FACTS (round 2, prototypes/seo_variants_20260928_r2.html): what the artist IS, as the site's
 * fact card states it. Who (type, sound, other names, the year they started), Where (city ·
 * region · country), About (the one bio, `#bio`; the booking address from Settings) and
 * Profiles (connected profiles, MusicBrainz, Discogs, Wikidata).
 *
 * Every value is checked by the SAME rules the save gate applies (lib/seo-facts.ts
 * `cleanFactValue`, the city's `factTextError`) before it is sent: a refusal shows under its
 * row in those words and is never sent. What the gate would tidy ("usa" → "United States") is
 * shown back once saved. Rows autosave to the draft; the layout's Publish bar ships them.
 */
export function FactsTab(p: FactsTabProps) {
  const { artistId, artistName } = p
  const [type, setType] = useState<SchemaType>(p.schemaType)
  const [genre, setGenre] = useState(p.genre)
  const [city, setCity] = useState(p.city)
  const [facts, setFacts] = useState(p.facts)
  const [errors, setErrors] = useState<Partial<Record<'type' | 'genre' | 'city' | FactField, string>>>(() => factErrors(p.facts, { name: artistName, location: p.city, schema_type: p.schemaType }, thisYearAt(new Date())))
  /** What the gate stored for a field whose text is still being typed ("Saved as …"). */
  const [tidied, setTidied] = useState<Partial<Record<FactField, string>>>({})
  const refuse = (k: keyof typeof errors, msg: string | null) => setErrors((e) => ({ ...e, [k]: msg ?? undefined }))

  const view = readFacts(facts, { name: artistName, location: city, schema_type: type })

  /* ── saving ── */
  const seoSave = useDebouncedFieldSave<string>({
    persist: async (key, val) => {
      const field = (Object.keys(FACT_CONTENT_KEYS) as FactField[]).find((f) => FACT_CONTENT_KEYS[f] === key)
      const r = await saveSeoFieldAction(artistId, key, val)
      if (field) {
        refuse(field, r.ok ? null : (r.error ?? 'Couldn’t save that.'))
        // Show back what the gate stored, when it tidied the text (a known country's name).
        if (r.ok) {
          const cleaned = cleanFactValue(key as (typeof FACT_CONTENT_KEYS)[FactField], val, { artistName, thisYear: thisYearAt(new Date()) })
          if ('value' in cleaned && cleaned.value !== val.trim()) setTidied((t) => ({ ...t, [field]: cleaned.value }))
        }
      }
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
  const cityChecked = (raw: string): string | null => factTextError(raw) ?? (Array.from(raw.trim()).length > CITY_MAX_LENGTH ? `Keep it under ${CITY_MAX_LENGTH} characters.` : null)
  const artistSave = useDebouncedFieldSave<string>({
    persist: async (col, val) => {
      const r = await saveArtistFactAction(artistId, col as 'genre' | 'location' | 'schema_type', val)
      refuse(col === 'location' ? 'city' : (col as 'genre'), r.ok ? null : (r.error ?? 'Couldn’t save that.'))
      return { ok: r.ok, error: r.error }
    },
    // The city's rule (the same as its region and country): a refused city is never sent.
    normalize: (val, col) => (col === 'location' && cityChecked(val) ? null : val),
  })

  /** A fact through its rule first: the gate's words shown and nothing sent, or queued. */
  const setFact = (field: FactField, raw: string) => {
    const key = FACT_CONTENT_KEYS[field]
    setFacts((f) => ({ ...f, [key]: raw }))
    setTidied((t) => ({ ...t, [field]: undefined }))
    const r = cleanFactValue(key, raw, { artistName, thisYear: thisYearAt(new Date()) })
    refuse(field, 'error' in r ? r.error : null)
    seoSave.save(key, raw)
  }

  const setCityValue = (raw: string) => {
    setCity(raw)
    refuse('city', cityChecked(raw))
    artistSave.save('location', raw)
  }

  const genres = genre
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const setGenres = (next: string[]): string | null => {
    const joined = next.join(', ')
    const bad = factTextError(joined) ?? (joined.length > GENRE_MAX ? `Keep it under ${GENRE_MAX} characters.` : null)
    if (bad) {
      refuse('genre', bad)
      return bad
    }
    refuse('genre', null)
    setGenre(joined)
    artistSave.runNow('genre', async () => {
      const r = await saveArtistFactAction(artistId, 'genre', joined)
      refuse('genre', r.ok ? null : (r.error ?? 'Couldn’t save that.'))
      return r
    })
    return null
  }

  const aliases = (facts[FACT_CONTENT_KEYS.aliases] ?? '').split(/\r\n?|\n/).map((a) => a.trim()).filter(Boolean)
  const setAliases = (next: string[]): string | null => {
    const raw = joinAliases(next)
    const r = cleanFactValue(FACT_CONTENT_KEYS.aliases, raw, { artistName, thisYear: thisYearAt(new Date()) })
    if ('error' in r) {
      refuse('aliases', r.error)
      return r.error
    }
    setFact('aliases', raw)
    return null
  }

  const changeType = (next: string) => {
    if (next !== 'MusicGroup' && next !== 'Person') return
    setType(next)
    artistSave.runNow('schema_type', async () => {
      const r = await saveArtistFactAction(artistId, 'schema_type', next)
      refuse('type', r.ok ? null : (r.error ?? 'Couldn’t save that.'))
      return r
    })
  }

  const person = type === 'Person'

  return (
    <div>
      <LedgerSection label="Who">
        <LedgerRow title="Type">
          <TypeMenu value={type} onChange={changeType} />
          <EndSlot />
        </LedgerRow>
        {errors.type ? <FieldError>{errors.type}</FieldError> : null}
        <LedgerRow title="Genre">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <Chips label="Genre" items={genres} onChange={setGenres} addLabel="Add a genre" />
            {errors.genre ? <FieldError>{errors.genre}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
        <LedgerRow title="Also known as" guide="Other spellings people search.">
          <div className="flex min-w-0 flex-col items-end gap-1">
            <Chips label="Also known as" items={aliases} onChange={setAliases} addLabel="Add a name" max={MAX_ALIASES} />
            {errors.aliases ? <FieldError>{errors.aliases}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
        <LedgerRow title="Active since" meta={person ? 'Not on your fact card for a visual artist' : undefined}>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <LineField
              label="Active since"
              value={facts[FACT_CONTENT_KEYS.activeSince] ?? ''}
              placeholder="Year"
              inputMode="numeric"
              invalid={!!errors.activeSince}
              onChange={(v) => setFact('activeSince', v)}
              className="w-[72px] text-right"
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
                <LineField label="Region" value={facts[FACT_CONTENT_KEYS.region] ?? ''} placeholder="—" invalid={!!errors.region} onChange={(v) => setFact('region', v)} className="w-[110px]" />
              </Cell>
              <Cell label="Country">
                <LineField
                  label="Country"
                  value={facts[FACT_CONTENT_KEYS.country] ?? ''}
                  placeholder="—"
                  invalid={!!errors.country}
                  onChange={(v) => setFact('country', v)}
                  onBlur={() => {
                    const t = tidied.country
                    if (!t) return
                    setFacts((f) => ({ ...f, [FACT_CONTENT_KEYS.country]: t }))
                    setTidied((x) => ({ ...x, country: undefined }))
                  }}
                  className="w-[130px]"
                />
              </Cell>
            </div>
            {tidied.country ? <span className="font-space text-[11px] text-ink-faint">{`Saved as ${tidied.country}`}</span> : null}
            {errors.city ? <FieldError>{errors.city}</FieldError> : null}
            {errors.region ? <FieldError>{errors.region}</FieldError> : null}
            {errors.country ? <FieldError>{errors.country}</FieldError> : null}
          </div>
          <EndSlot />
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="About">
        <BioRow artistId={artistId} bio={p.bio} goal={p.bioGoal} about={p.about} />
        <LedgerRow title="Booking">
          <span className="min-w-0 truncate font-space text-[12px] text-ink-muted">{`${p.bookingEmail || '—'} · from Settings`}</span>
          <EndSlot>
            <IconLink icon="external" label="Settings" href={`/artists/${artistId}/settings`} align="end" />
          </EndSlot>
        </LedgerRow>
      </LedgerSection>

      <LedgerSection label="Profiles">
        <LedgerRow title="Connected" meta={`${p.profiles.filter((l) => l.inFactCard).length} of ${p.profiles.length} in your fact card`}>
          {p.profiles.length ? (
            <span className="flex flex-wrap items-center justify-end gap-2.5 text-ink" aria-label="Connected profiles">
              {p.profiles.map((l) => (
                <span key={l.slug} title={l.label} className={cx('inline-flex', !l.inFactCard && 'text-ink-faint')}>
                  <PlatformMark slug={l.slug} />
                  <span className="sr-only">{l.label}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="font-space text-[12px] text-ink-faint">none yet</span>
          )}
          <EndSlot>
            <IconLink icon="external" label="Connections" href={`/artists/${artistId}/connections`} align="end" />
          </EndSlot>
        </LedgerRow>
        <DatabaseRow
          artistId={artistId}
          slug="musicbrainz"
          title="MusicBrainz"
          shown={p.databases.musicbrainz}
          missing={<span className="font-space text-[12px] text-accent-red">none</span>}
          add={<IconLink icon="external" label="Create the page" href={p.musicBrainzCreate} external primary align="end" />}
        />
        <DatabaseRow
          artistId={artistId}
          slug="discogs"
          title="Discogs"
          guide="Comes with a release."
          shown={p.databases.discogs}
          missing={<span className="font-space text-[11px] text-ink-faint">not yet</span>}
          add={<IconLink icon="plus" label="Add in Connections" href={`/artists/${artistId}/connections`} primary align="end" />}
        />
        <DatabaseRow
          artistId={artistId}
          slug="wikidata"
          title="Wikidata"
          guide="Needs press coverage first."
          shown={p.databases.wikidata}
          missing={<span className="font-space text-[11px] text-ink-faint">not yet</span>}
          add={<IconLink icon="plus" label="Add in Connections" href={`/artists/${artistId}/connections`} primary align="end" />}
        />
      </LedgerSection>
    </div>
  )
}

/** A small labelled cell (city · region · country), modal-kit's KvCells look. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span aria-hidden="true" className="font-space text-[9px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  )
}

/** Musician / Visual artist: the value, and the up-down glyph that says it's a choice. */
function TypeMenu({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const shown = TYPES.find((t) => t.value === value)?.label ?? 'Musician'
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label="Type"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex items-center gap-2.5 rounded-md text-[15px] text-ink', FOCUS_RING, 'focus-visible:outline-offset-2')}
      >
        {shown}
        <Icon name="chevronsUpDown" size={18} className="text-ink-faint" />
      </button>
      {open ? (
        <div id={listId} role="listbox" aria-label="Type" className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border border-hairline bg-paper py-1 shadow-2xl">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="option"
              aria-selected={t.value === value}
              onClick={() => {
                setOpen(false)
                if (t.value !== value) onChange(t.value)
              }}
              className={cx('flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface', t.value === value ? 'text-ink' : 'text-ink-muted')}
            >
              {t.label}
              {t.value === value ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** MusicBrainz, Discogs, Wikidata: connected (what's linked) or not (the way to add it). */
function DatabaseRow({
  artistId,
  slug,
  title,
  guide,
  shown,
  missing,
  add,
}: {
  artistId: string
  slug: string
  title: string
  guide?: string
  shown?: string
  missing: React.ReactNode
  add: React.ReactNode
}) {
  return (
    <LedgerRow title={title} guide={shown ? undefined : guide}>
      <span className={cx('inline-flex', shown ? 'text-ink' : 'text-ink-faint')}>
        <PlatformMark slug={slug} />
      </span>
      {shown ? <span className="min-w-0 truncate font-space text-[12px] text-ink-muted">{shown}</span> : missing}
      <EndSlot>{shown ? <IconLink icon="external" label="Connections" href={`/artists/${artistId}/connections`} align="end" /> : add}</EndSlot>
    </LedgerRow>
  )
}

/** The bio (`#bio`): its length against Tapir's goal, and the editor behind the pencil. */
function BioRow({ artistId, bio: initialBio, goal, about }: { artistId: string; bio: string; goal: number; about: { placement: string; heading: string } }) {
  const [bio, setBio] = useState(initialBio)
  const [open, setOpen] = useState(false)
  useOpenOnHash('bio', () => setOpen(true))
  const close = () => {
    setOpen(false)
    clearHash('bio')
  }
  const n = bio.trim().length
  return (
    <div id="bio" className="scroll-mt-28">
      <LedgerRow title="Bio" guide="Feeds About, Google and AI answers.">
        <span aria-hidden="true" className="block h-1 w-28 flex-none overflow-hidden rounded-sm bg-hairline">
          <i className="block h-full bg-ink" style={{ width: `${Math.min(100, (n / goal) * 100)}%` }} />
        </span>
        <span className="whitespace-nowrap font-space text-[12px] text-ink-muted">
          <span className={n < goal ? 'text-accent-red' : undefined}>{n.toLocaleString('en-US')}</span>
          {` / ${goal.toLocaleString('en-US')}`}
        </span>
        <EndSlot>
          <RowIcon icon="edit" label="Edit the bio" onClick={() => setOpen(true)} />
        </EndSlot>
      </LedgerRow>
      {open ? <BioModal artistId={artistId} bio={bio} goal={goal} about={about} onChange={setBio} onClose={close} /> : null}
    </div>
  )
}

/**
 * The bio editor: the one bio (artists.bio, through the editor's own gate), its length, and
 * where it shows. Placement offers only what can take effect here: `hidden` always, the rest
 * only when the connected site declares them, and this page has no declaration (the Site
 * panel in the editor does) — the old About section's rule, kept.
 */
function BioModal({
  artistId,
  bio,
  goal,
  about,
  onChange,
  onClose,
}: {
  artistId: string
  bio: string
  goal: number
  about: { placement: string; heading: string }
  onChange: (b: string) => void
  onClose: () => void
}) {
  const [placement, setPlacement] = useState(about.placement)
  const [heading, setHeading] = useState(about.heading)
  const bioSave = useDebouncedFieldSave<string>({
    persist: (_k, val) => saveEditorFieldAction(artistId, 'artist_bio', val, { store: 'artist', column: 'bio' }).then((r) => ({ ok: r.ok, error: r.error })),
    // Refused here too, before it is queued or sent: the server refuses it anyway, but this
    // box says why (TextLimitHint) and never spends a round trip finding out.
    normalize: (val) => (isTooLong(val, TEXT_LIMITS.bio) ? null : val),
  })
  const seoSave = useDebouncedFieldSave<string>({ persist: (k, val) => saveSeoFieldAction(artistId, k, val).then((r) => ({ ok: r.ok, error: r.error })) })
  const n = bio.trim().length
  const words = bio.trim() ? bio.trim().split(/\s+/).length : 0
  // A stored choice the editor made (with the site's declaration in hand) is kept on offer.
  const placements: AboutPlacement[] = ABOUT_PLACEMENTS.filter((x) => x === 'hidden' || x === about.placement)
  return (
    <CardModal open onClose={onClose} label="Bio">
      <ModalHeader
        square={<div className="flex h-full w-full items-center justify-center rounded-xl border border-hairline text-[15px] font-bold text-ink">Aa</div>}
        title="Bio"
        meta={
          <>
            <span>
              <span className={n < goal ? 'text-accent-red' : undefined}>{n.toLocaleString('en-US')}</span>
              {` / ${goal.toLocaleString('en-US')} characters`}
            </span>
            <MetaDot />
            {`${words} ${words === 1 ? 'word' : 'words'}`}
          </>
        }
      />
      <div className="mt-5">
        <AreaField
          label="Bio"
          value={bio}
          rows={8}
          placeholder="Who you are, your sound, your big shows and releases."
          onChange={(v) => {
            onChange(v)
            bioSave.save('artist_bio', v)
          }}
          className="max-h-[50vh] min-h-[180px] w-full overflow-auto"
        />
        <TextLimitHint value={bio} max={TEXT_LIMITS.bio} />
        {bioSave.status === 'error' ? <FieldError>Couldn’t save the bio.</FieldError> : null}
        <div className="mt-3 flex items-center gap-2.5">
          <span aria-hidden="true" className="block h-1 flex-1 overflow-hidden rounded-sm bg-hairline">
            <i className="block h-full bg-ink" style={{ width: `${Math.min(100, (n / goal) * 100)}%` }} />
          </span>
          <span className="font-space text-[11px] text-ink-faint">{`Tapir’s goal: ${goal.toLocaleString('en-US')}`}</span>
        </div>
      </div>
      <div className="mt-4">
        <KvRow label="Placement">
          <SelectMenu
            label="Placement"
            value={placement}
            placeholder="Site default"
            options={placements.map((x) => ({ value: x, label: PLACEMENT[x] }))}
            onChange={(v) => {
              setPlacement(v)
              seoSave.save('about_placement', v)
            }}
          />
        </KvRow>
        <KvRow label="Heading">
          <LineField
            label="Heading"
            value={heading}
            placeholder="About"
            onChange={(v) => {
              setHeading(v)
              seoSave.save('about_heading', v)
            }}
            className="w-full"
          />
        </KvRow>
        {seoSave.status === 'error' ? <FieldError>Couldn’t save that.</FieldError> : null}
      </div>
    </CardModal>
  )
}
