import { describe, expect, it } from 'vitest'
import { safeHref } from '@/lib/url'

describe('safeHref', () => {
  it('allows http/https/mailto/tel and relative URLs', () => {
    for (const ok of [
      'https://example.com/x',
      'http://example.com',
      'mailto:band@example.com',
      'tel:+15125551234',
      '/merch',
      '#top',
      'shop/page',
    ]) {
      expect(safeHref(ok)).toBe(ok)
    }
  })

  it('rejects dangerous schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://x/y',
      'file:///etc/passwd',
    ]) {
      expect(safeHref(bad)).toBeUndefined()
    }
  })

  it('returns undefined for empty/nullish', () => {
    expect(safeHref('')).toBeUndefined()
    expect(safeHref('   ')).toBeUndefined()
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
  })
})
