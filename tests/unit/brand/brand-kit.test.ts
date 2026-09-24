// The brand kit download: colors.txt formatting, and the zip fflate builds — unzipped
// with fflate's own reader so this test verifies real zip bytes, not just the object
// buildBrandKitZip happened to pass to zipSync.
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildBrandKitZip, colorsTxt } from '@/lib/brand-kit'

describe('colorsTxt', () => {
  it('writes one line per colour: name, hex, RGB r, g, b', () => {
    const txt = colorsTxt([
      { name: 'Ink', hex: '#000000' },
      { name: 'Paper', hex: '#ffffff' },
    ])
    expect(txt).toBe('Ink, #000000, RGB 0, 0, 0\nPaper, #ffffff, RGB 255, 255, 255\n')
  })

  it('expands a 3-digit hex the same way the picker does', () => {
    expect(colorsTxt([{ name: 'Sky', hex: '#0af' }])).toBe('Sky, #00aaff, RGB 0, 170, 255\n')
  })

  it('returns an empty string for no colours, not a stray newline', () => {
    expect(colorsTxt([])).toBe('')
  })

  it('does not throw on an unparsable hex; prints it raw and skips the RGB column', () => {
    expect(colorsTxt([{ name: 'Broken', hex: 'not-a-color' }])).toBe('Broken, not-a-color\n')
  })
})

describe('buildBrandKitZip', () => {
  it('zips the given files plus a generated colors.txt', () => {
    const zip = buildBrandKitZip(
      [
        { path: 'logo-primary.png', bytes: new Uint8Array([1, 2, 3]) },
        { path: 'favicon.png', bytes: new Uint8Array([4, 5, 6]) },
      ],
      [{ name: 'Ink', hex: '#000000' }],
    )
    const entries = unzipSync(zip)
    expect(Object.keys(entries).sort()).toEqual(['colors.txt', 'favicon.png', 'logo-primary.png'])
    expect(entries['logo-primary.png']).toEqual(new Uint8Array([1, 2, 3]))
    expect(entries['favicon.png']).toEqual(new Uint8Array([4, 5, 6]))
    expect(strFromU8(entries['colors.txt'])).toBe('Ink, #000000, RGB 0, 0, 0\n')
  })

  it('CRITICAL: a hostile path cannot escape the folder (zip-slip)', () => {
    const zip = buildBrandKitZip([{ path: '../../../etc/passwd', bytes: new Uint8Array([9]) }], [])
    const names = Object.keys(unzipSync(zip))
    for (const name of names) {
      expect(name.includes('..')).toBe(false)
      expect(name.includes('/')).toBe(false)
      expect(name.startsWith('/')).toBe(false)
    }
    // The traversal segments are dropped, not concatenated into "etcpasswd" — the
    // surviving segments are still readable, just flattened.
    expect(names).toContain('etc-passwd')
  })

  it('strips backslash traversal and control characters too', () => {
    const zip = buildBrandKitZip(
      [{ path: '..\\..\\windows\\system32\\evil.dll', bytes: new Uint8Array([1]) }],
      [],
    )
    const names = Object.keys(unzipSync(zip))
    expect(names).toContain('windows-system32-evil.dll')
  })

  it('de-duplicates two files that sanitise to the same name', () => {
    const zip = buildBrandKitZip(
      [
        { path: 'logo.png', bytes: new Uint8Array([1]) },
        { path: 'logo.png', bytes: new Uint8Array([2]) },
      ],
      [],
    )
    const entries = unzipSync(zip)
    const names = Object.keys(entries).filter((n) => n !== 'colors.txt')
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('CRITICAL: a file path that sanitises to "colors.txt" is renamed, never overwrites the real manifest', () => {
    const zip = buildBrandKitZip(
      [{ path: 'colors.txt', bytes: new Uint8Array([0xff]) }],
      [{ name: 'Ink', hex: '#000000' }],
    )
    const entries = unzipSync(zip)
    // The real manifest must still be the generated text, not the hostile file's bytes.
    expect(strFromU8(entries['colors.txt'])).toBe('Ink, #000000, RGB 0, 0, 0\n')
    // The hostile file survives under a different name rather than vanishing silently.
    const otherNames = Object.keys(entries).filter((n) => n !== 'colors.txt')
    expect(otherNames).toHaveLength(1)
    expect(entries[otherNames[0]]).toEqual(new Uint8Array([0xff]))
  })

  it('produces a zip with no colours and no files beyond colors.txt', () => {
    const zip = buildBrandKitZip([], [])
    const entries = unzipSync(zip)
    expect(Object.keys(entries)).toEqual(['colors.txt'])
    expect(strFromU8(entries['colors.txt'])).toBe('')
  })
})

describe('buildBrandKitZip — entry names, exactly', () => {
  const names = (paths: string[]) =>
    Object.keys(unzipSync(buildBrandKitZip(paths.map((path) => ({ path, bytes: new Uint8Array([1]) })), []))).filter((n) => n !== 'colors.txt')

  it('empty and "." segments vanish; control characters and edge spaces are stripped', () => {
    expect(names(['logo//x/./y.png'])).toEqual(['logo-x-y.png'])
    expect(names(['a\u0007b.png'])).toEqual(['ab.png'])
    expect(names(['  logo.png  '])).toEqual(['logo.png'])
  })

  it('a path with nothing printable left falls back to file-N, counted from 1', () => {
    expect(names(['///', '..'])).toEqual(['file-1', 'file-2'])
  })

  it('a third copy of one name is -3, not a reuse of a spare number', () => {
    expect(names(['logo.png', 'logo.png', 'logo.png'])).toEqual(['logo.png', 'logo.png-2', 'logo.png-3'])
  })
})
