// @vitest-environment jsdom
/**
 * The site Publish bar (SEO / GEO, Profile, Connections, EPK): it publishes what those pages
 * changed with one password, each part only when it is waiting, and it is gone when nothing waits.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/_ui/site-riser.tsx (was
 *           tools/seo/seo-riser.tsx until Profile shared it, 2026-10-02),
 *           src/lib/manager-tools/seo/pending.ts (pendingMessage)
 * Feature:  SEO / GEO, Profile, Connections and EPK · the site Publish bar
 * Tier:     STRICT (AGENTS.md "Test depth"): publishing is what the live site receives.
 * Covers:   • hidden means gone (invisible and inert) while nothing waits
 *           • site and links waiting: both published, site first, with the one password
 *           • only links waiting (a test's fix): the site publish is not run
 *           • a refused site publish (wrong password) stops before the links
 *           • the message says what is waiting, in a few words
 * Not here: the publish actions themselves (tests/unit/publish/); the run a publish starts
 *           (tests/unit/seo-tests/runs/publish-hook.test.ts).
 * Fixtures: both publish actions are mocks (no router: the actions' own revalidation re-renders
 *           the page, so the bar never refreshes it); `pendingMessage` gets a made-up unpublished
 *           diff.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SiteRiser } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/site-riser'
import { pendingMessage } from '@/lib/manager-tools/seo/pending'
import { publishEntityAction, publishSiteWithPasswordAction } from '@/app/artists/[id]/(dashboard)/actions'
import type { UnpublishedDiff } from '@/lib/content'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishSiteWithPasswordAction: vi.fn(async () => ({ ok: true })),
  publishEntityAction: vi.fn(async () => ({ ok: true })),
}))
const siteMock = vi.mocked(publishSiteWithPasswordAction)
const linkMock = vi.mocked(publishEntityAction)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement

async function publish(password = 'hunter2') {
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: password } })
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' })))
}

describe('the Publish bar (SiteRiser)', () => {
  // Hidden means gone: invisible and inert while nothing waits, so no dot or button shows under the fold.
  it('hidden means GONE: invisible while nothing waits, so no dot or button shows under the fold', () => {
    render(<SiteRiser artistId="a1" site={false} links={false} message="" />)
    expect(bar().className).toMatch(/(^|\s)invisible(\s|$)/)
    expect(bar().hasAttribute('inert')).toBe(true)
    cleanup()
    render(<SiteRiser artistId="a1" site links={false} message="Site text changed" />)
    expect(bar().className).not.toMatch(/(^|\s)invisible(\s|$)/)
  })
  // Both waiting: the site first, then the links, with the one password.
  it('CRITICAL: site and links waiting: both published, site first, with the one password', async () => {
    render(<SiteRiser artistId="a1" site links message="Site text and 1 link changed" />)
    await publish()
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith('link', 'a1', 'hunter2'))
    expect(siteMock).toHaveBeenCalledWith('a1', 'hunter2')
    expect(siteMock.mock.invocationCallOrder[0]).toBeLessThan(linkMock.mock.invocationCallOrder[0])
    expect(siteMock).toHaveBeenCalledTimes(1)
    expect(linkMock).toHaveBeenCalledTimes(1)
  })
  // Only links waiting (a test's fix): the site publish is not run.
  it('CRITICAL: only links waiting (a test’s fix): the site publish is not run', async () => {
    render(<SiteRiser artistId="a1" site={false} links message="1 link changed" />)
    await publish()
    await waitFor(() => expect(linkMock).toHaveBeenCalledTimes(1))
    expect(siteMock).not.toHaveBeenCalled()
  })
  // A refused site publish (wrong password) stops before the links.
  it('CRITICAL: a refused site publish (wrong password) stops before the links', async () => {
    siteMock.mockResolvedValueOnce({ ok: false, error: 'Wrong password.' })
    render(<SiteRiser artistId="a1" site links message="x" />)
    await publish('nope')
    await waitFor(() => expect(siteMock).toHaveBeenCalled())
    expect(linkMock).not.toHaveBeenCalled()
  })
})

describe('what the bar says is waiting (pendingMessage)', () => {
  const d = (over: Partial<Record<'profile' | 'site_content' | 'link' | 'media', Partial<{ added: number; edited: number; deleted: number; dirty: boolean }>>>) => {
    const s = (x: Partial<{ added: number; edited: number; deleted: number; dirty: boolean }> = {}) => ({ added: 0, edited: 0, deleted: 0, dirty: false, ...x })
    return { profile: s(over.profile), site_content: s(over.site_content), link: s(over.link), media: { ...s(over.media), site: s(over.media), brand: s() } } as unknown as UnpublishedDiff
  }
  // The message says what is waiting, in a few words.
  it('says what is waiting, in a few words', () => {
    expect(pendingMessage(d({}))).toBe('')
    expect(pendingMessage(d({ link: { edited: 1, dirty: true } }))).toBe('1 link changed')
    expect(pendingMessage(d({ site_content: { edited: 2, dirty: true }, link: { edited: 2, dirty: true } }))).toBe('Site text and 2 links changed')
    expect(pendingMessage(d({ profile: { dirty: true, edited: 1 }, site_content: { dirty: true, edited: 1 }, media: { dirty: true, edited: 1 } }))).toBe('Profile, site text and photos changed')
  })
})
