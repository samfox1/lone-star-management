'use client'

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import type { SeoCrawl, SeoTestStatus } from '@/lib/seo-tests/types'
import { HoverLabel } from '../../../_ui/row-icon'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { useMounted } from '../_ui/clock'
import {
  ASK_GOOGLE,
  BING_WEBMASTER,
  CRAWL_ROWS,
  SEARCH_CONSOLE,
  answered,
  bingWord,
  byCompany,
  canonicalDiffText,
  canonicalDiffers,
  canonicalState,
  crawlFaces,
  crawlOrigin,
  crawlToShow,
  dayText,
  decisionOf,
  fineCount,
  googleNotListed,
  googleWord,
  noindexBy,
  opens,
  redirectWord,
  requestIndexingHref,
  robotsLead,
  robotsNotes,
  ruleText,
  sendsHome,
  shortUrl,
  sitemapPages,
  visitOf,
  type CrawlFace,
  type CrawlMark,
  type CrawlRowId,
  type Words,
} from '@/lib/manager-tools/seo/crawl-model'
import { StatusMark } from './test-row'

/**
 * HOW CRAWLERS SEE YOUR SITE (Sam, 2026-09-30, round 11, prototypes/
 * seo_variants_20260930_r11.html): the first group on the done step, above the four test groups.
 * Five rows, each opening the same white card as a test row ("Dropdown A · Card": a mono caps
 * LABEL on the left, its value on the right):
 *
 *   robots.txt              THE FILE · WHO IT LETS IN (by company) · NOTE
 *   Sitemap                 ADDRESS · PAGES IN IT · NOTE
 *   Page address and tags   ADDRESS (the other spelling) · CANONICAL TAG · NOINDEX
 *   Crawler visits          EVERY VISIT (crawlers × pages) · NOTE
 *   Listed on Google/Bing   GOOGLE · BING · WHY IT MATTERS
 *
 * FACTS, not verdicts (types.ts SeoCrawl): the words and marks are lib/manager-tools/seo/crawl-model.ts's. Nothing is
 * drawn for a run without a crawl, or with a shape version this page doesn't know.
 *
 * EVERYTHING HERE CAME FROM THE SITE OR FROM GOOGLE / BING: rendered as React text only. Dates
 * are the manager's own time zone, so they appear only after mount (_ui/clock.ts), never on the server.
 *
 * The row and card are test-row.tsx's grammar, drawn here (its Card is private to one test
 * result): the same row face, the same StatusMark, the same card box and label.
 */

const TITLE = 'How crawlers see your site'
const EYEBROW = 'font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint'
/** The thin line between two closed rows (test-row.tsx's). */
const DIVIDER = 'shadow-[0_-1px_0_var(--color-hairline-soft)]'

const MARK_STATUS: Record<CrawlMark, SeoTestStatus> = { ok: 'pass', bad: 'fail', unknown: 'unknown' }
const MARK_WORD: Record<CrawlMark, string> = { ok: 'fine', bad: 'needs you', unknown: 'couldn’t see' }

const rowId = (id: CrawlRowId) => `seo-crawl-row-${id}`
const cardId = (id: CrawlRowId) => `seo-crawl-detail-${id}`

export function CrawlSection({ crawl, site }: { crawl: SeoCrawl | null | undefined; site: string }) {
  const [openId, setOpenId] = useState<CrawlRowId | null>(null)
  const mounted = useMounted()
  const c = crawlToShow(crawl)
  if (!c) return null
  const origin = crawlOrigin(c, site)
  const faces = crawlFaces(c, origin)
  const { fine, total } = fineCount(faces)

  function onKey(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement
    if (e.key === 'Escape' && openId) {
      // Handled here, so the test list around this section doesn't also close its open row.
      e.preventDefault()
      e.stopPropagation()
      const id = openId
      setOpenId(null)
      document.getElementById(rowId(id))?.focus()
      return
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.matches('[data-crawl-row]')) {
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-crawl-row]'))
      const next = rows[rows.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  }

  return (
    <section aria-label={TITLE} data-crawl-section="" onKeyDown={onKey}>
      <div className="mb-0.5 mt-[26px] flex items-baseline justify-between gap-4">
        <h3 className={cx(EYEBROW, 'font-normal')}>{TITLE}</h3>
        <span data-crawl-fine="" className="font-space text-[11px] text-ink-faint">{`${fine} of ${total} fine`}</span>
      </div>
      <div className="-mx-3">
        {CRAWL_ROWS.map((r, i) => {
          const open = openId === r.id
          return (
            <CrawlRow
              key={r.id}
              id={r.id}
              name={r.name}
              face={faces[r.id]}
              open={open}
              divider={i > 0 && !open && openId !== CRAWL_ROWS[i - 1].id}
              onToggle={() => setOpenId((o) => (o === r.id ? null : r.id))}
            >
              {open ? <CardBody id={r.id} crawl={c} origin={origin} mounted={mounted} /> : null}
            </CrawlRow>
          )
        })}
      </div>
    </section>
  )
}

function CrawlRow({ id, name, face, open, divider, onToggle, children }: { id: CrawlRowId; name: string; face: CrawlFace; open: boolean; divider: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div data-crawl-item={id} className={cx('rounded-xl', open ? 'my-1 bg-surface' : divider && DIVIDER)}>
      <button
        id={rowId(id)}
        type="button"
        data-crawl-row=""
        data-mark={face.mark}
        aria-expanded={open}
        aria-controls={cardId(id)}
        onClick={onToggle}
        className={cx('group/trow flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-colors hover:bg-surface', FOCUS_RING, 'focus-visible:-outline-offset-2')}
      >
        <StatusMark status={MARK_STATUS[face.mark]} />
        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3.5">
          <span className="min-w-0 flex-1 text-[15px] font-medium leading-[1.35] text-ink [overflow-wrap:anywhere]">{name}</span>
          <span className="sr-only">, {MARK_WORD[face.mark]}</span>
          <span data-crawl-value="" className={cx('min-w-0 max-w-full truncate whitespace-nowrap font-space text-[12px] sm:max-w-[200px]', face.mark === 'bad' ? 'text-accent-red' : 'text-ink-faint')}>
            {face.value}
          </span>
        </span>
        <Icon
          name="chevronRight"
          size={14}
          aria-hidden="true"
          className={cx('flex-none transition-transform duration-150', open ? 'rotate-90 text-ink' : 'text-ink-faint group-hover/trow:text-ink')}
        />
      </button>
      {open ? (
        <div id={cardId(id)} role="region" aria-labelledby={rowId(id)} className="px-3 pb-3 pt-0.5 sm:pb-[22px] sm:pl-[46px] sm:pr-3.5">
          <div className="grid grid-cols-1 gap-y-1.5 rounded-xl border border-hairline bg-paper px-5 py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] min-[700px]:grid-cols-[100px_minmax(0,1fr)] min-[700px]:gap-x-5 min-[700px]:gap-y-5">
            {children}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── the card's pieces ── */

/** One LABEL | value row of the card. Beside its value from 700px, above it on a phone. */
function Field({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  return (
    <>
      <span className="pt-3 font-space text-[10px] uppercase leading-[1.4] tracking-[0.1em] text-ink-faint first:pt-0 min-[700px]:pt-1 min-[700px]:first:pt-1">{label}</span>
      <div data-card={name} className="min-w-0">
        {children}
      </div>
    </>
  )
}

/** Words, with robots.txt lines set in mono. */
function Say({ words }: { words: Words }) {
  return (
    <>
      {words.map((w, i) =>
        typeof w === 'string' ? (
          <span key={i}>{w}</span>
        ) : (
          <b key={i} className="font-space text-[12px] font-semibold">
            {w.code}
          </b>
        ),
      )}
    </>
  )
}

function Lead({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return <p className={cx('text-[14px] leading-normal text-ink', !last && 'mb-2.5')}>{children}</p>
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 font-space text-[11px] leading-normal text-ink-faint [overflow-wrap:anywhere]">{children}</p>
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-normal text-ink-muted">{children}</p>
}

/** A mark and its word, inside a table cell: ✓ 200, ⚠ no, ◌ unknown. */
function Mark({ mark, word }: { mark: CrawlMark | null; word?: string }) {
  return (
    <span data-state={mark ?? 'none'} className="inline-flex items-center gap-[5px] align-middle">
      {mark === 'ok' ? (
        <Icon name="check" size={14} aria-hidden="true" className="flex-none text-ink" />
      ) : mark === 'bad' ? (
        <Icon name="alert" size={14} aria-hidden="true" className="flex-none text-accent-red" />
      ) : mark === 'unknown' ? (
        <span aria-hidden="true" className="h-[11px] w-[11px] flex-none rounded-full border-[1.4px] border-dashed border-ink-faint" />
      ) : null}
      {word ? <span className={cx('font-space text-[11px]', mark === 'bad' ? 'text-accent-red' : 'text-ink-muted')}>{word}</span> : null}
    </span>
  )
}

const TH = 'border-b border-hairline pb-2 pr-3 text-left align-bottom font-space text-[10px] font-normal uppercase tracking-[0.1em] text-ink-faint'
const TD = 'border-b border-hairline-soft py-[7px] pr-3 align-middle text-ink'
const MONO = 'font-space text-[12px] text-ink-faint'

function Table({ head, children }: { head?: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-[13.5px] [&_tbody_tr:last-child>td]:border-b-0">
      {head ? <thead>{head}</thead> : null}
      <tbody>{children}</tbody>
    </table>
  )
}

/** A company's name across the table, above its crawlers. */
function CompanyRow({ name, span, first }: { name: string; span: number; first: boolean }) {
  return (
    <tr data-company={name}>
      <td colSpan={span} className={cx('border-b-0 pb-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint', first ? 'pt-1.5' : 'pt-3.5')}>
        {name}
      </td>
    </tr>
  )
}

/** A bare ↗ glyph with its name on hover and focus, like a test row's action. */
function OutsideLink({ link }: { link: { label: string; href: string } }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={link.label}
      className={cx('relative ml-2.5 inline-flex rounded align-[-3px] text-ink transition-colors hover:text-accent', FOCUS_RING, 'focus-visible:outline-offset-2')}
    >
      <Icon name="external" size={17} aria-hidden="true" />
      <HoverLabel label={link.label} align="start" />
    </a>
  )
}

/** "ASK GOOGLE ↗" beside a page Google doesn't list: Search Console's inspect page for it, where
 *  its "Request indexing" button is (a new tab). */
function AskGoogleLink({ href, path }: { href: string; path: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${ASK_GOOGLE} to list ${path}`}
      data-ask-google
      className={cx(
        'ml-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded align-middle font-space text-[10px] uppercase tracking-[0.1em] text-ink transition-colors hover:text-accent',
        FOCUS_RING,
        'focus-visible:outline-offset-2',
      )}
    >
      {ASK_GOOGLE}
      <Icon name="external" size={12} aria-hidden="true" />
    </a>
  )
}

function CardBody({ id, crawl, origin, mounted }: { id: CrawlRowId; crawl: SeoCrawl; origin: string | null; mounted: boolean }) {
  // A date only after mount: the manager's own time zone, never the server's.
  const day = (iso: string | null | undefined) => (mounted ? dayText(iso) : '')
  switch (id) {
    case 'robots':
      return <RobotsCard crawl={crawl} />
    case 'sitemap':
      return <SitemapCard crawl={crawl} day={day} />
    case 'tags':
      return <TagsCard crawl={crawl} origin={origin} />
    case 'visits':
      return <VisitsCard crawl={crawl} />
    case 'listed':
      return <ListedCard crawl={crawl} origin={origin} day={day} />
  }
}

/* ── 1. robots.txt ── */

const VERDICT: Record<'allowed' | 'blocked' | 'unknown', { mark: CrawlMark; word: string }> = {
  allowed: { mark: 'ok', word: 'yes' },
  blocked: { mark: 'bad', word: 'no' },
  unknown: { mark: 'unknown', word: 'unknown' },
}

function RobotsCard({ crawl }: { crawl: SeoCrawl }) {
  const r = crawl.robots
  const lead = robotsLead(r.bots)
  const notes = robotsNotes(r.text)
  const where = [shortUrl(r.url), answered(r.status), r.truncated ? 'first 2,000 characters' : null].filter(Boolean).join(' · ')
  const groups = byCompany(r.bots)
  return (
    <>
      <Field label="The file" name="file">
        {r.text != null ? (
          <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-[10px] bg-surface px-3.5 py-3 font-space text-[12px] leading-[1.65] text-ink [overflow-wrap:anywhere]">{r.text}</pre>
        ) : null}
        <Caption>{where}</Caption>
      </Field>
      <Field label="Who it lets in" name="who">
        {lead ? (
          <Lead>
            <Say words={lead.words} />
          </Lead>
        ) : null}
        <Table
          head={
            <tr>
              <th className={TH}>Crawler</th>
              <th className={TH}>Its name in robots.txt</th>
              <th className={TH}>Allowed</th>
            </tr>
          }
        >
          {groups.map((g, gi) => [
            <CompanyRow key={`co-${g.company}`} name={g.company} span={3} first={gi === 0} />,
            ...g.bots.map((b) => {
              const v = VERDICT[b.verdict] ?? VERDICT.unknown
              // Its own rule, when the line above doesn't already say it.
              const own = lead?.common === decisionOf(b) ? '' : ruleText(b)
              return (
                <tr key={b.key} data-bot={b.key}>
                  <td className={TD}>{b.who}</td>
                  <td className={cx(TD, MONO)}>{b.token}</td>
                  <td className={TD}>
                    <Mark mark={v.mark} word={v.word} />
                    {own ? <span className={cx('mt-0.5 block text-[11px] [overflow-wrap:anywhere]', MONO)}>{own}</span> : null}
                  </td>
                </tr>
              )
            }),
          ])}
        </Table>
      </Field>
      {notes.length ? (
        <Field label="Note" name="note">
          {notes.map((n, i) => (
            <Note key={i}>
              <Say words={n} />
            </Note>
          ))}
        </Field>
      ) : null}
    </>
  )
}

/* ── 2. the sitemap ── */

function SitemapCard({ crawl, day }: { crawl: SeoCrawl; day: (iso: string | null | undefined) => string }) {
  const s = crawl.sitemap
  const pages = sitemapPages(crawl)
  const total = Math.max(s.total, pages.length)
  return (
    <>
      <Field label="Address" name="address">
        {s.url ? (
          <>
            <p className="text-[14px] leading-normal text-ink [overflow-wrap:anywhere]">{shortUrl(s.url)}</p>
            <Caption>
              {answered(s.status)} · named in robots.txt <Mark mark={s.namedInRobots ? 'ok' : 'bad'} />
            </Caption>
          </>
        ) : (
          <Lead last>We didn’t find a sitemap.</Lead>
        )}
      </Field>
      {pages.length ? (
        <Field label="Pages in it" name="pages">
          <Table
            head={
              <tr>
                <th className={TH}>Page</th>
                <th className={TH}>Opens</th>
                <th className={TH}>Last updated</th>
              </tr>
            }
          >
            {pages.map((p, i) => (
              <tr key={`${p.path}-${i}`} data-page={p.path}>
                <td className={cx(TD, MONO, 'text-ink [overflow-wrap:anywhere]')}>{p.path}</td>
                <td className={TD}>{p.opened ? <Mark mark={opens(p.status) ? 'ok' : 'bad'} word={p.status == null ? 'no answer' : String(p.status)} /> : <span className={MONO}>not opened</span>}</td>
                <td className={cx(TD, MONO, 'whitespace-nowrap')}>{day(p.lastmod)}</td>
              </tr>
            ))}
          </Table>
          {total > pages.length ? <Caption>{`The first ${pages.length} of ${total} pages.`}</Caption> : null}
        </Field>
      ) : null}
      {s.sameDates && pages.length > 1 ? (
        <Field label="Note" name="note">
          <Note>Every page has the same date, so the list doesn’t say which page changed last. Search engines may ignore dates like that.</Note>
        </Field>
      ) : null}
    </>
  )
}

/* ── 3. page address and tags ── */

const CANONICAL: Record<'self' | 'other' | 'none', { mark: CrawlMark | null; word: string }> = {
  self: { mark: 'ok', word: 'itself' },
  other: { mark: 'bad', word: 'another page' },
  none: { mark: null, word: 'no tag' },
}

function TagsCard({ crawl, origin }: { crawl: SeoCrawl; origin: string | null }) {
  const oh = crawl.otherHost
  const read = crawl.pages.filter((p) => opens(p.status))
  const differs = read.filter(canonicalDiffers)
  const skip = read.filter((p) => noindexBy(p))
  const toOwn = !!oh && sendsHome(oh, origin)
  const permanent = oh?.status === 301 || oh?.status === 308
  return (
    <>
      {oh ? (
        <Field label="Address" name="address">
          {/* One line that wraps on a phone: the other spelling → where it sends you · how. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-space text-[12px] text-ink-faint [overflow-wrap:anywhere]">
            <span className="text-ink">{shortUrl(oh.url)}</span>
            {oh.to ? <span>{`→ ${shortUrl(oh.to)}`}</span> : opens(oh.status) ? <span>opens on its own</span> : null}
            {oh.to ? <Mark mark={toOwn ? (permanent ? 'ok' : null) : 'bad'} word={redirectWord(oh.status)} /> : <Mark mark={opens(oh.status) ? null : 'bad'} word={answered(oh.status)} />}
          </div>
          {toOwn && permanent ? <Caption>One address for the whole site, so search engines don’t split you in two.</Caption> : null}
          {!oh.to && opens(oh.status) ? <Caption>Both addresses show your site.</Caption> : null}
        </Field>
      ) : null}
      <Field label="Canonical tag" name="canonical">
        {read.length ? (
          <>
            <Table
              head={
                <tr>
                  <th className={TH}>Page</th>
                  <th className={TH}>Says its real address is</th>
                  <th className={TH} />
                </tr>
              }
            >
              {read.map((p) => {
                // What a person is told, marked red when any visitor (Google, Bing) is sent elsewhere.
                const states = [p.canonical.person, p.canonical.google, p.canonical.bing].map((u) => canonicalState(u, origin, p.path))
                const c = CANONICAL[states.includes('other') ? 'other' : states[0]]
                return (
                  <tr key={p.path} data-page={p.path}>
                    <td className={cx(TD, MONO, 'text-ink')}>{p.path}</td>
                    <td className={cx(TD, MONO, '[overflow-wrap:anywhere]')}>{p.canonical.person ? shortUrl(p.canonical.person) : ''}</td>
                    <td className={TD}>
                      <Mark mark={c.mark} word={c.word} />
                    </td>
                  </tr>
                )
              })}
            </Table>
            {differs.length ? (
              differs.map((p) => <Caption key={p.path}>{canonicalDiffText(p)}</Caption>)
            ) : (
              <Caption>The same for a person, Google and Bing.</Caption>
            )}
          </>
        ) : (
          <Lead last>No page opened, so there were no tags to read.</Lead>
        )}
      </Field>
      <Field label="Noindex" name="noindex">
        {!read.length ? (
          <Lead last>No page opened, so we couldn’t check.</Lead>
        ) : skip.length ? (
          <>
            <Lead>These pages tell search engines to leave them out:</Lead>
            <Table>
              {skip.map((p) => (
                <tr key={p.path} data-page={p.path}>
                  <td className={cx(TD, MONO, 'text-ink')}>{p.path}</td>
                  <td className={TD}>
                    <Mark mark="bad" word={noindexBy(p) ?? ''} />
                  </td>
                </tr>
              ))}
            </Table>
          </>
        ) : (
          <Lead last>
            <Mark mark="ok" /> None. No page tag or header tells search engines to skip a page.
          </Lead>
        )}
      </Field>
    </>
  )
}

/* ── 4. crawler visits ── */

function VisitsCard({ crawl }: { crawl: SeoCrawl }) {
  const pages = crawl.pages
  const groups = byCompany(crawl.robots.bots)
  const span = pages.length + 1
  return (
    <>
      <Field label="Every visit" name="visits">
        {/* The crawler's name wraps; the page columns don't, so many pages on a phone scroll
            the table sideways, never the page. */}
        <div className="overflow-x-auto">
          <Table
            head={
              <tr>
                <th className={TH}>Crawler</th>
                {pages.map((p) => (
                  <th key={p.path} className={cx(TH, 'whitespace-nowrap text-center')}>
                    {p.path}
                  </th>
                ))}
              </tr>
            }
          >
            {groups.map((g, gi) => [
              <CompanyRow key={`co-${g.company}`} name={g.company} span={span} first={gi === 0} />,
              ...g.bots.map((b) => (
                <tr key={b.key} data-bot={b.key}>
                  <td className={TD}>
                    {b.who} <span className={cx(MONO, 'whitespace-nowrap')}>{b.token}</span>
                  </td>
                  {b.visits ? (
                    pages.map((p) => {
                      const s = visitOf(p, b.key)
                      return (
                        <td key={p.path} data-cell={p.path} className={cx(TD, 'whitespace-nowrap text-center')}>
                          <Mark mark={s == null ? 'unknown' : opens(s) ? 'ok' : 'bad'} word={s == null ? 'no answer' : String(s)} />
                        </td>
                      )
                    })
                  ) : (
                    <td colSpan={pages.length} data-robots-only="" className={cx(TD, MONO, 'text-center')}>
                      doesn’t visit · robots.txt only
                    </td>
                  )}
                </tr>
              )),
            ])}
          </Table>
        </div>
      </Field>
      <Field label="Note" name="note">
        <Note>We visit using each crawler’s name, from our own server. A firewall that checks who is really visiting can treat the real crawler differently.</Note>
      </Field>
    </>
  )
}

/* ── 5. listed on Google and Bing ── */

function ListedCard({ crawl, origin, day }: { crawl: SeoCrawl; origin: string | null; day: (iso: string | null | undefined) => string }) {
  const g = Array.isArray(crawl.listing.google) ? crawl.listing.google : null
  const b = Array.isArray(crawl.listing.bing) ? crawl.listing.bing : null
  return (
    <>
      <Field label="Google" name="google">
        {g ? (
          <Table
            head={
              <tr>
                <th className={TH}>Page</th>
                <th className={TH}>On Google</th>
                <th className={TH}>Last crawled</th>
              </tr>
            }
          >
            {g.map((e, i) => {
              const w = googleWord(e)
              const ask = googleNotListed(e) ? requestIndexingHref(origin, e.path) : null
              return (
                <tr key={`${e.path}-${i}`} data-page={e.path}>
                  <td className={cx(TD, MONO, 'text-ink')}>{e.path}</td>
                  <td className={TD}>
                    <Mark mark={w.mark} word={w.word} />
                    {ask ? <AskGoogleLink href={ask} path={e.path} /> : null}
                  </td>
                  <td className={cx(TD, MONO, 'whitespace-nowrap')}>{day(e.lastCrawl)}</td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <Lead last>
            We can’t see this from outside. Google Search Console shows which of your pages Google has listed.
            <OutsideLink link={SEARCH_CONSOLE} />
          </Lead>
        )}
      </Field>
      {/* Bing says when it last visited a page, never whether it lists it: no "listed" here. */}
      <Field label="Bing" name="bing">
        {b ? (
          <Table
            head={
              <tr>
                <th className={TH}>Page</th>
                <th className={TH}>Bing’s last visit</th>
                <th className={TH}>It got</th>
              </tr>
            }
          >
            {b.map((e, i) => (
              <tr key={`${e.path}-${i}`} data-page={e.path}>
                <td className={cx(TD, MONO, 'text-ink')}>{e.path}</td>
                <td className={cx(TD, MONO)}>{bingWord(e, day(e.lastCrawled))}</td>
                <td className={TD}>{e.status == null ? null : <Mark mark={opens(e.status) ? 'ok' : 'bad'} word={String(e.status)} />}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Lead last>
            We can’t see this from outside. Bing Webmaster Tools shows how Bing sees your pages.
            <OutsideLink link={BING_WEBMASTER} />
          </Lead>
        )}
      </Field>
      <Field label="Why it matters" name="why">
        <Note>ChatGPT search reads Bing’s list, and Gemini reads Google’s. A page that isn’t listed can’t come up in their answers.</Note>
      </Field>
    </>
  )
}
