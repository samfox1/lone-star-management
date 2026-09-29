// The SEO / GEO tabs: the registry, the rail's tabs, every route, and where the old seven went.
/**
 * Sam, 2026-09-28 (round 2): five tabs on the thin rail, Overview · Listing · Facts · Answers ·
 * Test, replacing seven pill sections. Nothing that worked may lose its home: each old section
 * route redirects to the tab (and the row) that now holds it.
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
  it('five tabs, unique, Overview first as the tool’s own route', () => {
    expect(SEO_SECTIONS.map((s) => s.label)).toEqual(['Overview', 'Listing', 'Facts', 'Answers', 'Test'])
    expect(new Set(SEO_SECTIONS.map((s) => s.seg)).size).toBe(SEO_SECTIONS.length)
    for (const s of SEO_SECTIONS) expect(isSeoSection(s.seg)).toBe(true)
    expect(isSeoSection('logo')).toBe(false)
    expect(SEO_TABS[0].seg).toBe(SEO_BASE)
  })
  it('CRITICAL: the rail lists exactly these tabs for the SEO / GEO tool', () => {
    const tool = TOOLS.find((t) => t.seg === SEO_BASE)!
    expect(tool.tabs).toEqual(SEO_TABS)
  })
  it('CRITICAL: every tab has its own page.tsx', () => {
    for (const s of SEO_SECTIONS) expect(existsSync(join(TOOL_DIR, seoTabSeg(s.seg), 'page.tsx')), s.label).toBe(true)
  })
})

describe('the old sections land on their new homes', () => {
  it('CRITICAL: every old section is still a tab or redirects to one', () => {
    for (const old of OLD_SECTIONS) {
      const home = isSeoSection(old) ? old : MOVED_SEO_SECTIONS[old]?.to
      expect(home, old).toBeDefined()
      expect(isSeoSection(home!), old).toBe(true)
    }
  })
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
