// @vitest-environment jsdom
// A template-hosted artist can never pass the SEO live check, so the panel must not run it.
/**
 * CODE_AUDIT finding (2026-09-18): the built-in `classic`/`cinematic` templates carry no
 * sitemap.xml, no robots.txt and no JSON-LD script (verified: `find src/app -iname
 * "sitemap*" -o -iname "robots*"` and `grep -rn "jsonLd" src/app/[slug]
 * src/components/artist-site.tsx src/components/templates/` both come back empty). The
 * bridge's own rules therefore always fail those two checks for a template-hosted artist
 * — the default tier, and FTBK today (custom_site_url = localhost, demoted in prod). A
 * manager on that tier saw a permanently red "Run check" with no path to green.
 *
 * The fix scopes the live check to artists on a real custom site (`isCustom`,
 * src/lib/custom-site.ts:198) — the tool must not present a check that cannot pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AuditPanel } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/audit-panel'
import { runSeoAuditAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  runSeoAuditAction: vi.fn(async () => ({
    url: 'https://app.example.com/skeen',
    ok: false,
    rules: [
      { rule: 'json-ld', label: 'Structured data', problems: ['no application/ld+json script'] },
      { rule: 'robots', label: 'robots.txt', problems: ['missing'] },
    ],
    graph: {},
    releaseKinds: {},
    sitemap: null,
    robots: null,
  })),
}))
const runMock = vi.mocked(runSeoAuditAction)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuditPanel — template-hosted artists never see a live check that cannot pass', () => {
  it('CRITICAL: not on a custom site — Run check never fires, and nothing red appears', async () => {
    render(<AuditPanel artistId="a1" siteUrl="https://app.example.com/skeen" custom={false} />)
    const button = screen.getByRole('button', { name: /run check/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    // Give any accidental async call a turn to land before asserting it never did.
    await new Promise((r) => setTimeout(r, 0))
    expect(runMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/to fix/i)).toBeNull()
    expect(screen.queryByText(/no application\/ld\+json/i)).toBeNull()
  })

  it('on a real custom site, the check still runs and can still report a failure', async () => {
    render(<AuditPanel artistId="a1" siteUrl="https://www.skeenmusic.com" custom />)
    const button = screen.getByRole('button', { name: /run check/i })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledWith('a1'))
    await screen.findByText(/to fix/i)
  })
})
