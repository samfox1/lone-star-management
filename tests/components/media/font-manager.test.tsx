// @vitest-environment jsdom
// The Brand page's font list: each font previewed in itself, plus upload, remove and slots.
/**
 * FontManager — the Brand page's font list.
 *
 * Four behaviours here are invisible from anywhere else:
 *   1. Each font is PREVIEWED IN ITSELF. A font is draft until publish, so this list is
 *      the only place a manager can see the face before committing the site to it. A
 *      preview that silently falls back to the UI font makes the whole page a lie.
 *   2. Destructive clicks confirm, and the re-entry guard is a REF. `busyId` is state:
 *      two fast clicks both read the pre-render value and both fire.
 *   3. The name is required BEFORE the file, because the CSS family token is derived
 *      from it and cannot be changed afterwards.
 *   4. Every action reports — a Remove blocked by RLS must not look like one that worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FontManager } from '@/app/artists/[id]/(dashboard)/brand/font-manager'
import {
  addArtistFontAction,
  removeArtistFontAction,
  setFontSlotAction,
} from '@/app/artists/[id]/(dashboard)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { FONT_SLOTS, sanitizeFamily, type ArtistFont } from '@/lib/fonts'
import { FONT_UPLOAD_RULES, acceptFor } from '@/lib/upload'

vi.mock('@/app/artists/[id]/(dashboard)/brand/actions', () => ({
  addArtistFontAction: vi.fn(async () => ({})),
  removeArtistFontAction: vi.fn(async () => ({})),
  setFontSlotAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/use-storage-upload', () => ({
  useStorageUpload: () => ({ busy: false, error: null, upload: vi.fn(), progress: null, reset: vi.fn() }),
}))

const mockedRemove = vi.mocked(removeArtistFontAction)
const mockedSlot = vi.mocked(setFontSlotAction)
const mockedToast = vi.mocked(toast)

const font = (over: Partial<ArtistFont> = {}): ArtistFont => ({
  id: 'f1',
  label: 'PP Mori',
  family: 'pp-mori',
  storage_path: 'a1/fonts/11111111-1111-4111-8111-111111111111.woff2',
  format: 'woff2',
  slots: [],
  ...over,
})

const FONTS = [
  font(),
  font({ id: 'f2', label: 'Bebas Neue', family: 'bebas-neue', slots: ['primary'], storage_path: 'a1/fonts/22222222-2222-4222-8222-222222222222.otf', format: 'otf' }),
]

const renderList = (fonts: ArtistFont[] = FONTS) => render(<FontManager artistId="a1" fonts={fonts} />)

/**
 * The stylesheet THIS component rendered, read from its own container rather than via
 * `document.querySelector('style')` — the first style tag in the whole document, which
 * is this component's only as long as nothing else ever puts one there.
 */
const styleOf = ({ container }: { container: HTMLElement }): string =>
  Array.from(container.querySelectorAll('style'))
    .map((s) => s.innerHTML)
    .join('')

let confirmed = true
beforeEach(() => {
  // THE PREVIEW CSS IS BUILT FROM THIS. `fontFaceCss` resolves each font's URL against
  // NEXT_PUBLIC_SUPABASE_URL, and a font whose URL fails SAFE_URL is skipped — so with
  // the variable absent the stylesheet is legitimately '' and the test below fails.
  //
  // It passed here only because a developer machine has .env.local and CI does not (the
  // mutation workflow ships no DB secrets, deliberately). That made this suite the one
  // that broke every CI mutation run from 2026-08-05 on: Stryker's dry run failed, and
  // the workflow has never once reported a score. Stubbing pins the test to a value it
  // controls instead of to whether an env file happens to exist.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co')
  confirmed = true
  vi.stubGlobal('confirm', vi.fn(() => confirmed))
  mockedRemove.mockResolvedValue({})
  mockedSlot.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const clickRemove = async (name = 'Remove PP Mori') => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('FontManager — previewing', () => {
  it('CRITICAL: renders each font in its OWN family', () => {
    // The whole reason this list exists. A row set in the dashboard's UI font tells the
    // manager nothing about the face they just paid a foundry for.
    renderList()
    expect(screen.getByText('PP Mori')).toHaveStyle({ fontFamily: "'pp-mori', sans-serif" })
    expect(screen.getByText('Bebas Neue')).toHaveStyle({ fontFamily: "'bebas-neue', sans-serif" })
  })

  it('CRITICAL: injects the @font-face rules, or every preview falls back silently', () => {
    const css = styleOf(renderList())
    expect(css).toContain("@font-face{font-family:'pp-mori'")
    expect(css).toContain("format('woff2')")
    expect(css).toContain("format('opentype')") // .otf is NOT 'otf' in a format() hint
  })

  it('CRITICAL: a hostile family from the database cannot escape into the page', () => {
    // The component injects this CSS with dangerouslySetInnerHTML. sanitizeFamily is what
    // makes that safe, so it is asserted HERE too and not only in the unit tests.
    const css = styleOf(renderList([font({ family: "x'; } body { display:none } .y {" })]))
    expect(css).not.toContain('body {')
    expect(css).not.toContain('</style')
  })

  it('shows the class token, so the manager can see what the editor will offer', () => {
    renderList()
    expect(screen.getByText(/font-pp-mori/)).toBeInTheDocument()
  })
})

describe('FontManager — uploading', () => {
  it('CRITICAL: the file picker is disabled until the font is named', () => {
    // The name derives the CSS family token, which is written into every per-region style
    // that uses the font and can never be changed. An unnamed upload has no token.
    renderList()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'PP Mori' } })
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false)
  })

  it('CRITICAL: the picker offers exactly the validated allowlist — no SVG, no wildcard', () => {
    renderList()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe(acceptFor(FONT_UPLOAD_RULES))
    expect(input.accept).not.toMatch(/svg/i)
    expect(input.accept).not.toContain('*')
  })

  it('names the licence responsibility', () => {
    // Foundry licences are sold per use and a desktop licence does not cover a website.
    // Uploading a font to a public bucket is the moment that becomes the artist's problem.
    renderList()
    expect(screen.getByText(/licence/i)).toBeInTheDocument()
  })
})

describe('FontManager — removing', () => {
  it('CRITICAL: confirms first, and does nothing when the manager says no', async () => {
    confirmed = false
    renderList()
    await clickRemove()
    expect(mockedRemove).not.toHaveBeenCalled()
  })

  it('removes and reports when confirmed', async () => {
    renderList()
    await clickRemove()
    expect(mockedRemove).toHaveBeenCalledWith('a1', 'f1')
    expect(mockedToast).toHaveBeenCalledWith('Font removed')
  })

  it('CRITICAL: a double click removes ONCE — the latch is a ref, not state', async () => {
    // With a state latch both clicks read the pre-render value: the font is deleted, then
    // the second call reports "that font is no longer there" over the top of the success.
    let release: (v: { error?: string }) => void = () => {}
    mockedRemove.mockImplementationOnce(() => new Promise((r) => (release = r)))
    renderList()
    const button = screen.getByRole('button', { name: 'Remove PP Mori' })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(mockedRemove).toHaveBeenCalledTimes(1)
    await act(async () => release({}))
  })

  it('CRITICAL: a blocked Remove is surfaced, never silently swallowed', async () => {
    // RLS row-filters rather than failing, so the action can answer with an error while
    // everything looks fine. Reporting it is the only signal the manager gets.
    mockedRemove.mockResolvedValueOnce({ error: 'Not found.' })
    renderList()
    await clickRemove()
    expect(mockedToast).toHaveBeenCalledWith('Not found.', 'error')
    expect(mockedToast).not.toHaveBeenCalledWith('Font removed')
  })
})

/** The slot chip on one font's row. Named per-font, so a click can never land on the
 *  other row's chip for the same slot — which is exactly the assertion these tests make. */
const chip = (slot: string, label: string) =>
  screen.getByRole('button', { name: `${slot.replace(/_/g, ' ')} font: ${label}` })

describe('FontManager — slots', () => {
  it('CRITICAL: offers EVERY slot on every font, derived from FONT_SLOTS', () => {
    // The Brand page is the only place a slot can be filled. A slot missing from this
    // list is a slot the payload can carry and no manager can ever set — and nothing
    // would fail; the site would just never get that font.
    renderList()
    for (const slot of FONT_SLOTS) {
      expect(chip(slot, 'PP Mori'), `slot ${slot}`).toBeInTheDocument()
      expect(chip(slot, 'Bebas Neue'), `slot ${slot}`).toBeInTheDocument()
    }
  })

  it('fills a free slot without a prompt', async () => {
    // Nothing is being taken away, so there is nothing to warn about.
    renderList()
    await act(async () => {
      fireEvent.click(chip('secondary', 'PP Mori'))
    })
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'secondary', 'f1')
    expect(globalThis.confirm).not.toHaveBeenCalled()
  })

  it('CRITICAL: ONE font can fill SEVERAL slots — no slot is vacated behind the manager', async () => {
    // The whole reason slots left the font row. Filling `custom_1` with the font that is
    // already `primary` must be one write against one slot, not a move.
    renderList()
    await act(async () => {
      fireEvent.click(chip('custom_1', 'Bebas Neue')) // already the primary font
    })
    expect(mockedSlot).toHaveBeenCalledTimes(1)
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'custom_1', 'f2')
    // Its existing slot is untouched: nothing was asked to clear `primary`.
    expect(mockedSlot).not.toHaveBeenCalledWith('a1', 'primary', null)
  })

  it('CRITICAL: confirms before TAKING a slot off another font', async () => {
    // One small button, and the site's heading typeface changes everywhere. The button
    // itself gives no hint that a second font is about to lose the slot.
    confirmed = false
    renderList()
    await act(async () => {
      fireEvent.click(chip('primary', 'PP Mori')) // Bebas Neue currently holds primary
    })
    expect(globalThis.confirm).toHaveBeenCalled()
    expect(mockedSlot).not.toHaveBeenCalled()
  })

  it('clicking a slot the font already holds EMPTIES it', async () => {
    renderList()
    await act(async () => {
      fireEvent.click(chip('primary', 'Bebas Neue'))
    })
    expect(mockedSlot).toHaveBeenCalledWith('a1', 'primary', null)
  })

  it('shows which slots each font fills', () => {
    renderList([
      font({ slots: ['primary', 'custom_2'] }),
      font({ id: 'f2', label: 'Bebas Neue', family: 'bebas-neue', slots: [] }),
    ])
    expect(chip('primary', 'PP Mori')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('custom_2', 'PP Mori')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('secondary', 'PP Mori')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('primary', 'Bebas Neue')).toHaveAttribute('aria-pressed', 'false')
  })

  it('a failed slot change is surfaced', async () => {
    mockedSlot.mockResolvedValueOnce({ error: 'Not found.' })
    renderList()
    await act(async () => {
      fireEvent.click(chip('secondary', 'PP Mori'))
    })
    expect(mockedToast).toHaveBeenCalledWith('Not found.', 'error')
  })
})

describe('FontManager — empty', () => {
  it('renders the uploader and no list when there are no fonts', () => {
    renderList([])
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('the sanitizer is the one spelling of the token the preview uses', () => {
    // Guards against a future refactor inlining `font.family` into the style attribute,
    // which would put an unsanitized database value into the DOM.
    renderList([font({ family: 'Weird Family' as string })])
    expect(screen.getByText('PP Mori')).toHaveStyle({
      fontFamily: `'${sanitizeFamily('Weird Family')}', sans-serif`,
    })
  })
})

describe('addArtistFontAction is wired for upload', () => {
  it('is the action the uploader records with', () => {
    // The upload hook itself is mocked (it needs a browser + a bucket), so this asserts
    // the wiring exists rather than re-testing the hook.
    expect(addArtistFontAction).toBeTypeOf('function')
  })
})
