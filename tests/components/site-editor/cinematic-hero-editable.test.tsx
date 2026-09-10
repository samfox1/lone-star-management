// @vitest-environment jsdom
// The cinematic hero marks its image and text regions in edit mode.
/**
 * The cinematic hero emits its markers in edit mode: the hero MEDIA (image here —
 * no clips, so the poster branch renders) is an image field, and the tagline / cta
 * are text fields. Rendered with `clips: []` so the video montage effect never runs
 * in jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CinematicHero } from '@/components/templates/cinematic-hero'

afterEach(cleanup)

describe('cinematic hero — edit-mode markers', () => {
  it('marks the hero image, tagline and cta when editable', () => {
    const { container } = render(
      <CinematicHero name="Demo" clips={[]} poster="https://img/hero.jpg" tagline="DJ" cta="Shows" editable />,
    )
    expect(container.querySelector('[data-lse-field="hero_image"]')).not.toBeNull()
    expect(container.querySelector('[data-lse-field="hero_tagline"]')).not.toBeNull()
    expect(container.querySelector('[data-lse-field="hero_cta"]')).not.toBeNull()
  })

  it('emits no markers when not editable', () => {
    const { container } = render(
      <CinematicHero name="Demo" clips={[]} poster="https://img/hero.jpg" tagline="DJ" cta="Shows" />,
    )
    expect(container.querySelector('[data-lse-field]')).toBeNull()
  })
})
