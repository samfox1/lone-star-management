// @vitest-environment jsdom
// The editor's live preview paints a brand colour token as the site's --brand-<key> variable.
/**
 * The string-level tests (tests/unit/site-editor/site-bridge-brand-tokens.test.ts) pin what a
 * brand token RESOLVES to. This is the other half: the frame's applier, the code that runs
 * in the site's page while the manager drags, actually writes it onto the element, and a
 * later pick of a plain hex takes it back off (MANAGED_STYLE_PROPS clears `color`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createStyleApplier } from '@samfox1/site-bridge/frame'

afterEach(() => {
  document.body.innerHTML = ''
})

function region(key: string): HTMLElement {
  const el = document.createElement('h1')
  el.setAttribute('data-lse-style', key)
  document.body.appendChild(el)
  return el
}

describe('live apply of a brand colour token', () => {
  it('CRITICAL: writes var(--brand-cream, #f4f1ea) and keeps the token out of the class list', () => {
    const el = region('hero')
    const applier = createStyleApplier({ regionBase: () => 'uppercase text-ink' })
    applier.applyStyleToDom(document, 'hero', 'lse-delta text-[brand-cream_#f4f1ea]')
    expect(el.style.getPropertyValue('color')).toBe('var(--brand-cream, #f4f1ea)')
    expect(el.getAttribute('class')).toBe('uppercase')
  })

  it('a custom hex picked afterwards replaces it', () => {
    const el = region('hero')
    const applier = createStyleApplier({ regionBase: () => 'text-ink' })
    applier.applyStyleToDom(document, 'hero', 'lse-delta text-[brand-cream_#f4f1ea]')
    applier.applyStyleToDom(document, 'hero', 'lse-delta text-[#ff0000]')
    expect(el.style.getPropertyValue('color')).toBe('rgb(255, 0, 0)')
  })

  it('a malformed brand token paints nothing and leaves the base colour class', () => {
    const el = region('hero')
    const applier = createStyleApplier({ regionBase: () => 'text-ink' })
    applier.applyStyleToDom(document, 'hero', 'lse-delta text-[brand-cream);color:red_#f4f1ea]')
    expect(el.style.getPropertyValue('color')).toBe('')
    expect(el.getAttribute('class')).toBe('text-ink')
  })
})
