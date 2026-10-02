/**
 * The SEO / GEO page has four tabs on the rail, each with its own page, the tool opens on
 * Details, and every old section address still lands on the tab (and the row) that now holds it:
 * an SEO tab, or Profile for the facts and the bio (Facts left SEO / GEO on 2026-10-02).
 *
 * Code:     src/lib/manager-tools/seo/sections.ts,
 *           tools/seo/[section]/page.tsx (the redirect route), _shell/tools-registry.ts
 * Feature:  SEO / GEO page · its tabs: Details · Answers · AI test · Profiles (Facts moved to
 *           the Profile tool 2026-10-02; Profiles added 2026-09-30, outside profiles; Sam, 2026-09-29:
 *           Listing became Details, the tool's own route; Overview was removed; Test became
 *           "AI test". Before that, 2026-09-28, round 2: five tabs replacing seven pill sections)
 * Tier:     STRICT (AGENTS.md "Test depth"): nothing that worked may lose its home, and a bad
 *           address must be a 404, not a crash.
 * Covers:   • four tabs, unique, Details first as the tool's own route
 *           • the rail lists exactly these tabs; every tab has its own page.tsx
 *           • no folder that is not a tab has a page.tsx (a leftover one would shadow its redirect)
 *           • every old section is still a tab or redirects to one (or to Profile); the redirect
 *             route sends each to its tab and row, and anything else (including "__proto__") is a 404
 *           • the old Listing address lands on Details, the old Facts address on Profile; each old
 *             address lands where its test's pencil does
 * Not here: where each test's pencil lands (test-tab-model.test.ts, "every pencil target").
 * Fixtures: next/navigation's redirect and notFound throw, so a test can read where they went;
 *           the page files are checked on disk; the old sections are listed by hand (history).
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MOVED_SEO_SECTIONS,
  SEO_BASE,
  SEO_EDIT_TARGETS,
  SEO_SECTIONS,
  SEO_TABS,
  isSeoSection,
  seoTabSeg,
} from '@/lib/manager-tools/seo/sections'
import { TOOLS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-registry'
import { PROFILE_SEG } from '@/lib/manager-tools/profile/route'

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
  notFound: () => {
    throw new Error('NOT FOUND')
  },
}))

const TOOL_DIR = join(process.cwd(), 'src/app/artists/[id]/(dashboard)/(manager-tools)')

/** The seven sections the page had before (2026-08-28 → 2026-09-28), and Listing, a tab of its
 *  own until 2026-09-29 (already one of the seven). History, so listed. */
const OLD_SECTIONS = ['listing', 'logo', 'facts', 'about', 'alt', 'ai', 'test']

/** Which pencil each moved address matches: it holds the same setting (history, so listed). */
const PENCIL_OF_OLD: Record<string, keyof typeof SEO_EDIT_TARGETS> = { listing: 'listing', logo: 'share', alt: 'alt', facts: 'facts', about: 'bio', ai: 'answers' }

const moved = async (section: string) => {
  const { default: Moved } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/[section]/page')
  return Moved({ params: Promise.resolve({ id: 'a1', section }) })
}

describe('the registry', () => {
  // Four tabs, unique, Details first as the tool's own route, so the tool opens on it.
  it('four tabs, unique, Details first as the tool’s own route', () => {
    expect(SEO_SECTIONS.map((s) => s.label)).toEqual(['Details', 'Answers', 'AI test', 'Profiles'])
    expect(new Set(SEO_SECTIONS.map((s) => s.seg)).size).toBe(SEO_SECTIONS.length)
    for (const s of SEO_SECTIONS) expect(isSeoSection(s.seg)).toBe(true)
    expect(isSeoSection('logo')).toBe(false)
    expect(isSeoSection('listing')).toBe(false)
    expect(isSeoSection('facts')).toBe(false)
    expect(SEO_SECTIONS[0].seg).toBe('')
    expect(SEO_TABS[0]).toEqual({ seg: SEO_BASE, label: 'Details' })
  })
  // The rail shows exactly these tabs for the SEO / GEO tool.
  it('CRITICAL: the rail lists exactly these tabs for the SEO / GEO tool', () => {
    const tool = TOOLS.find((t) => t.seg === SEO_BASE)!
    expect(tool.tabs).toEqual(SEO_TABS)
  })
  // Every tab has its own page on disk, so no tab is a dead link.
  it('CRITICAL: every tab has its own page.tsx', () => {
    for (const s of SEO_SECTIONS) expect(existsSync(join(TOOL_DIR, seoTabSeg(s.seg), 'page.tsx')), s.label).toBe(true)
  })
  // A page.tsx in a folder that is not a tab is a stray route; under an old name it would win
  // over the redirect route (Next matches a static folder first), so the redirect would never run.
  it('CRITICAL: no folder that is not a tab has a page.tsx (a leftover one would shadow its redirect)', () => {
    const seoDir = join(TOOL_DIR, SEO_BASE)
    const folders = readdirSync(seoDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('['))
    expect(folders.length).toBeGreaterThan(0) // the scan found the tool's folders, so the check below is not vacuous
    for (const d of folders) if (existsSync(join(seoDir, d.name, 'page.tsx'))) expect(isSeoSection(d.name), d.name).toBe(true)
    for (const old of Object.keys(MOVED_SEO_SECTIONS)) expect(existsSync(join(seoDir, old, 'page.tsx')), old).toBe(false)
  })
})

describe('the old sections land on their new homes', () => {
  // Every old section still has a home: it is a tab, or it redirects to one, or to Profile.
  it('CRITICAL: every old section is still a tab or redirects to a tab or to Profile', () => {
    const homes = [...SEO_SECTIONS.map((s) => seoTabSeg(s.seg)), PROFILE_SEG]
    for (const old of OLD_SECTIONS) {
      const home = isSeoSection(old) ? seoTabSeg(old) : MOVED_SEO_SECTIONS[old]?.to
      expect(home, old).toBeDefined()
      expect(homes, old).toContain(home)
    }
  })
  // The redirect route sends each moved section to its tab and row; anything else is a 404.
  it('the redirect route sends each moved section to its tab and row; anything else is a 404', async () => {
    for (const [old, to] of Object.entries(MOVED_SEO_SECTIONS)) {
      await expect(moved(old)).rejects.toThrow(`REDIRECT /artists/a1/${to.to}${to.hash ? `#${to.hash}` : ''}`)
    }
    for (const junk of ['nope', 'constructor', '__proto__', 'toString']) {
      await expect(moved(junk)).rejects.toThrow('NOT FOUND')
    }
  })
  // The old Listing tab's address (Sam's bookmarks, old links) lands on Details, the tool's own page.
  it('CRITICAL: /tools/seo/listing lands on Details, the tool’s own page', async () => {
    await expect(moved('listing')).rejects.toThrow(new RegExp(`^REDIRECT /artists/a1/${SEO_BASE}$`))
  })
  // The old Facts tab's address (bookmarks, old links) lands on Profile, which now holds the facts.
  it('CRITICAL: /tools/seo/facts lands on Profile; /tools/seo/about on Profile’s bio', async () => {
    await expect(moved('facts')).rejects.toThrow(new RegExp(`^REDIRECT /artists/a1/${PROFILE_SEG}$`))
    await expect(moved('about')).rejects.toThrow(new RegExp(`^REDIRECT /artists/a1/${PROFILE_SEG}#bio$`))
  })
  // An old address and a test's pencil for the same setting land on the same tab and row.
  it('each moved address lands exactly where the pencil for the same setting lands', async () => {
    expect(Object.keys(PENCIL_OF_OLD).sort()).toEqual(Object.keys(MOVED_SEO_SECTIONS).sort())
    for (const [old, pencil] of Object.entries(PENCIL_OF_OLD)) {
      await expect(moved(old), old).rejects.toThrow(new RegExp(`^REDIRECT /artists/a1/${SEO_EDIT_TARGETS[pencil]}$`))
    }
  })
})
