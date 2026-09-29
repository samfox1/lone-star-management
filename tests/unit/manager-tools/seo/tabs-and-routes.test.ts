/**
 * The SEO / GEO page has five tabs on the rail, each with its own page, and every old section
 * address still lands on the tab (and the row) that now holds it.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections.ts,
 *           tools/seo/[section]/page.tsx (the redirect route), _shell/tools-registry.ts
 * Feature:  SEO / GEO page · its tabs: Overview · Listing · Facts · Answers · Test (Sam,
 *           2026-09-28, round 2: replacing seven pill sections)
 * Tier:     STRICT (AGENTS.md "Test depth"): nothing that worked may lose its home, and a bad
 *           address must be a 404, not a crash.
 * Covers:   • five tabs, unique, Overview first as the tool's own route
 *           • the rail lists exactly these tabs; every tab has its own page.tsx
 *           • every old section is still a tab or redirects to one; the redirect route sends each
 *             to its tab and row, and anything else (including "__proto__") is a 404
 * Not here: where each test's pencil lands (test-tab-model.test.ts, "every pencil target").
 * Fixtures: next/navigation's redirect and notFound throw, so a test can read where they went;
 *           the page files are checked on disk; the seven old sections are listed by hand (history).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MOVED_SEO_SECTIONS, SEO_BASE, SEO_SECTIONS, SEO_TABS, isSeoSection, seoTabSeg } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { TOOLS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-registry'

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
  notFound: () => {
    throw new Error('NOT FOUND')
  },
}))

const TOOL_DIR = join(process.cwd(), 'src/app/artists/[id]/(dashboard)/(manager-tools)')

/** The seven sections the page had before (2026-08-28 → 2026-09-28). History, so listed. */
const OLD_SECTIONS = ['listing', 'logo', 'facts', 'about', 'alt', 'ai', 'test']

describe('the registry', () => {
  // Five tabs, unique, Overview first as the tool's own route.
  it('five tabs, unique, Overview first as the tool’s own route', () => {
    expect(SEO_SECTIONS.map((s) => s.label)).toEqual(['Overview', 'Listing', 'Facts', 'Answers', 'Test'])
    expect(new Set(SEO_SECTIONS.map((s) => s.seg)).size).toBe(SEO_SECTIONS.length)
    for (const s of SEO_SECTIONS) expect(isSeoSection(s.seg)).toBe(true)
    expect(isSeoSection('logo')).toBe(false)
    expect(SEO_TABS[0].seg).toBe(SEO_BASE)
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
})

describe('the old sections land on their new homes', () => {
  // Every old section still has a home: it is a tab, or it redirects to one.
  it('CRITICAL: every old section is still a tab or redirects to one', () => {
    for (const old of OLD_SECTIONS) {
      const home = isSeoSection(old) ? old : MOVED_SEO_SECTIONS[old]?.to
      expect(home, old).toBeDefined()
      expect(isSeoSection(home!), old).toBe(true)
    }
  })
  // The redirect route sends each moved section to its tab and row; anything else is a 404.
  it('the redirect route sends each moved section to its tab and row; anything else is a 404', async () => {
    const { default: Moved } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/[section]/page')
    for (const [old, to] of Object.entries(MOVED_SEO_SECTIONS)) {
      await expect(Moved({ params: Promise.resolve({ id: 'a1', section: old }) })).rejects.toThrow(`REDIRECT /artists/a1/${seoTabSeg(to.to)}${to.hash ? `#${to.hash}` : ''}`)
    }
    for (const junk of ['nope', 'constructor', '__proto__', 'toString']) {
      await expect(Moved({ params: Promise.resolve({ id: 'a1', section: junk }) })).rejects.toThrow('NOT FOUND')
    }
  })
})
