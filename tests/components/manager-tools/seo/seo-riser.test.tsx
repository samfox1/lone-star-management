// @vitest-environment jsdom
// The SEO / GEO Publish bar: what it ships, one password, and gone when nothing waits.
/**
 * seo-riser.tsx publishes what the SEO tabs change: the site's words / profile / photos
 * (`publishSiteWithPasswordAction`) and the links a test's fix changes (`publishEntityAction`
 * 'link'). STRICT: publishing is what the live site receives. Each part only when it is waiting;
 * a refused first part stops the second.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SeoRiser } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/seo-riser'
import { pendingMessage } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/pending'
import { publishEntityAction, publishSiteWithPasswordAction } from '@/app/artists/[id]/(dashboard)/actions'
import type { UnpublishedDiff } from '@/lib/content'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishSiteWithPasswordAction: vi.fn(async () => ({ ok: true })),
  publishEntityAction: vi.fn(async () => ({ ok: true })),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
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

describe('SeoRiser', () => {
  it('hidden means GONE: invisible while nothing waits, so no dot or button shows under the fold', () => {
    render(<SeoRiser artistId="a1" site={false} links={false} message="" />)
    expect(bar().className).toMatch(/(^|\s)invisible(\s|$)/)
    expect(bar().hasAttribute('inert')).toBe(true)
    cleanup()
    render(<SeoRiser artistId="a1" site links={false} message="Site text changed" />)
    expect(bar().className).not.toMatch(/(^|\s)invisible(\s|$)/)
  })
  it('CRITICAL: site and links waiting: both published, site first, with the one password', async () => {
    render(<SeoRiser artistId="a1" site links message="Site text and 1 link changed" />)
    await publish()
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith('link', 'a1', 'hunter2'))
    expect(siteMock).toHaveBeenCalledWith('a1', 'hunter2')
    expect(siteMock.mock.invocationCallOrder[0]).toBeLessThan(linkMock.mock.invocationCallOrder[0])
    expect(refresh).toHaveBeenCalled()
  })
  it('CRITICAL: only links waiting (a test’s fix): the site publish is not run', async () => {
    render(<SeoRiser artistId="a1" site={false} links message="1 link changed" />)
    await publish()
    await waitFor(() => expect(linkMock).toHaveBeenCalledTimes(1))
    expect(siteMock).not.toHaveBeenCalled()
  })
  it('CRITICAL: a refused site publish (wrong password) stops before the links', async () => {
    siteMock.mockResolvedValueOnce({ ok: false, error: 'Wrong password.' })
    render(<SeoRiser artistId="a1" site links message="x" />)
    await publish('nope')
    await waitFor(() => expect(siteMock).toHaveBeenCalled())
    expect(linkMock).not.toHaveBeenCalled()
  })
})

describe('pendingMessage', () => {
  const d = (over: Partial<Record<'profile' | 'site_content' | 'link' | 'media', Partial<{ added: number; edited: number; deleted: number; dirty: boolean }>>>) => {
    const s = (x: Partial<{ added: number; edited: number; deleted: number; dirty: boolean }> = {}) => ({ added: 0, edited: 0, deleted: 0, dirty: false, ...x })
    return { profile: s(over.profile), site_content: s(over.site_content), link: s(over.link), media: { ...s(over.media), site: s(over.media), brand: s() } } as unknown as UnpublishedDiff
  }
  it('says what is waiting, in a few words', () => {
    expect(pendingMessage(d({}))).toBe('')
    expect(pendingMessage(d({ link: { edited: 1, dirty: true } }))).toBe('1 link changed')
    expect(pendingMessage(d({ site_content: { edited: 2, dirty: true }, link: { edited: 2, dirty: true } }))).toBe('Site text and 2 links changed')
    expect(pendingMessage(d({ profile: { dirty: true, edited: 1 }, site_content: { dirty: true, edited: 1 }, media: { dirty: true, edited: 1 } }))).toBe('Profile, site text and photos changed')
  })
})
