// @vitest-environment jsdom
/**
 * THE VERSION GATE IS WIRED, not just implemented.
 *
 * The 2026-08-17 multi-agent review proved this by mutation: dropping
 * `withStyleVars(…, manifest?.bridgeVersion)` from EditorShell's styleOptions prop left
 * all 1,941 DB-free tests green — because every gate test calls withStyleVars directly,
 * and every inspector test injects styleOptions as a raw prop. Unwired, the flags
 * default to "emit value tokens", so the editor writes `size-[48px]` / `weight-[700]`
 * to EVERY remote site regardless of bridge version, and a pre-0.16 applier leaves them
 * as dead classes — the silent regression the gate exists to prevent.
 *
 * So this renders the REAL shell, announces a manifest over the real bridge handshake,
 * and asserts the styleOptions the inspector receives carry flags derived from the
 * announced bridgeVersion. Expectations are DERIVED from the gate functions, not
 * hand-written booleans, so a new era joins the assertion when its gate does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { EditorShell } from '@/app/artists/[id]/(dashboard)/editor/editor-shell'
import {
  bridgeSupportsStyleVars,
  bridgeSupportsTextVars,
} from '@/lib/site-editor/manifest'
import type { EditorStyleOptions } from '@/lib/site-editor/style-controls'
import { BRIDGE_VERSION, FRAME_SOURCE } from '@samfox1/site-bridge/protocol'

/** The inspector, replaced by a prop trap. The shell's wiring is the subject; the
 *  panel's rendering is pinned elsewhere. */
const seen: { styleOptions?: EditorStyleOptions }[] = []
vi.mock('@/app/artists/[id]/(dashboard)/editor/editor-inspector', () => ({
  EditorInspector: (props: { styleOptions?: EditorStyleOptions }) => {
    seen.push(props)
    return null
  },
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({}))
vi.mock('@/app/artists/[id]/(dashboard)/media-uploader', () => ({
  MediaUploader: () => null,
  GallerySlotUploader: () => null,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.stubGlobal(
  'ResizeObserver',
  class { observe() {} unobserve() {} disconnect() {} },
)

const CUSTOM = 'https://skeen-website.vercel.app'

function announce(bridgeVersion?: string) {
  seen.length = 0
  render(
    <EditorShell
      artistId="artist-1" customSiteUrl={CUSTOM} draft={null} photos={[]}
      imageFields={[]} textFields={[]} siteContent={{}} links={[]}
      supportLinks={[]} linkValues={{}} videos={[]} merch={[]} releases={[]} tours={[]}
    />,
  )
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          v: BRIDGE_VERSION, source: FRAME_SOURCE, type: 'ready',
          manifest: {
            template: 'skeen', fields: [], slots: [], links: [],
            styles: [{ key: 'hero', label: 'Hero' }],
            styleOptions: { fonts: [{ value: 'font-momo', label: 'Momo' }] },
            ...(bridgeVersion ? { bridgeVersion } : {}),
          },
        },
        origin: CUSTOM,
      }),
    )
  })
  return seen.at(-1)!.styleOptions as EditorStyleOptions
}

afterEach(cleanup)

describe('EditorShell derives the token gates from the ANNOUNCED bridgeVersion', () => {
  for (const version of ['0.15.0', '0.16.0', '0.18.0', undefined]) {
    it(`announced ${version ?? 'no version'} → flags match the gates`, () => {
      const opts = announce(version)
      // The witness that the manifest actually reached the options at all — a shell
      // that ignored the announcement would hand the inspector no fonts and the flag
      // assertions below could pass against a default object.
      expect(opts.fonts?.map((f) => f.value)).toContain('font-momo')
      expect(opts.styleVars, 'styleVars').toBe(bridgeSupportsStyleVars(version))
      expect(opts.textVars, 'textVars').toBe(bridgeSupportsTextVars(version))
    })
  }

  it('the eras genuinely differ across these fixtures (self-check)', () => {
    // If the gates ever collapsed to one behaviour, every case above would still pass
    // while asserting nothing about the wiring order. 0.16 is the split fixture.
    expect(bridgeSupportsStyleVars('0.16.0')).toBe(true)
    expect(bridgeSupportsTextVars('0.16.0')).toBe(false)
  })
})
