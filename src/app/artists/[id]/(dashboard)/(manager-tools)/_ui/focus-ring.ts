/**
 * THE KEYBOARD RING every manager-tool control wears, in one place (Brand and Subscribers
 * each spelled it out by hand, six times between them).
 *
 * `outline-hidden` drops the browser's own outline, and in Tailwind v4 it does that by
 * setting `--tw-outline-style: none`, which `outline-2` then reads. So a ring declared
 * under `focus-visible:` paints only if the SAME variant also says `outline-solid`
 * (tests/components/manager-tools/shared/focus-rings.test.tsx pins the contract). Without
 * it the ring silently never shows: that is how the Brand page first shipped.
 *
 * No offset: callers add their own (`focus-visible:outline-offset-2` on Brand's icons and
 * dots, none on a control inside a field). Two offsets on one element would leave the
 * winner to the stylesheet's order.
 */
export const FOCUS_RING = 'outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent'
