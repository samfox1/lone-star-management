/**
 * The social preview card (`og:image`): the artist's logo centred on a SOLID background,
 * at the shape every platform crops to.
 *
 * Why generate one rather than point og:image at the logo file, which is what the SEO
 * page used to accept as a URL:
 *
 *   • TRANSPARENCY. A logo PNG is RGBA. Facebook, X, Slack and the rest composite
 *     og:image onto THEIR background, so a black logo on alpha renders black-on-black in
 *     every dark-mode client. The manager sees a perfect logo in the dashboard and a
 *     blank square in the share, with nothing anywhere reporting a problem.
 *   • ASPECT. Previews are ~1.91:1. A 1.42:1 logo gets cropped or letterboxed, and which
 *     one is the platform's choice, not ours.
 *
 * Baking the background into a correctly-shaped canvas settles both where we can see the
 * result. The stored value stays a plain absolute https URL under the `og_image`
 * site_content key, so the contract with a consuming site is unchanged.
 */

/** The shape every major platform crops toward (~1.91:1). */
export const OG_CARD_WIDTH = 1200
export const OG_CARD_HEIGHT = 630

/** Keep the logo off the bleed: platforms round corners and overlay their own chrome
 *  (a play badge, a domain label) on the card. 12% of the height each side leaves the
 *  mark intact under all of it. */
const INSET = 0.12

export type OgBackground = { value: string; label: string; hex: string }

/**
 * What a card can sit on. Both extremes are offered because a logo is one or the other:
 * a white wordmark needs a dark card and a black one needs a light card, and shipping
 * only a single default guarantees half of all artists get an invisible image.
 */
export const OG_BACKGROUNDS: OgBackground[] = [
  { value: 'white', label: 'White', hex: '#ffffff' },
  { value: 'black', label: 'Black', hex: '#000000' },
  { value: 'ink', label: 'Off-black', hex: '#111111' },
  { value: 'paper', label: 'Off-white', hex: '#f5f5f0' },
]

/**
 * The fill for a stored background value.
 *
 * Falls back to WHITE, never to "no fill": the whole point of this card is that it is
 * opaque, and a value that stopped resolving would silently reintroduce the
 * black-on-black bug it exists to prevent.
 */
export function ogBackgroundHex(value: string | undefined): string {
  return OG_BACKGROUNDS.find((b) => b.value === value)?.hex ?? '#ffffff'
}

export type DrawBox = { x: number; y: number; width: number; height: number }

/**
 * Where the logo goes on the card: contained (never cropped), aspect preserved, centred,
 * and inset from the edge.
 *
 * CONTAIN rather than cover, deliberately: cover would crop, and a cropped wordmark is
 * one with its last letter missing on the image that represents the artist everywhere
 * their link is shared.
 */
export function ogCardDrawBox(image: { width: number; height: number }): DrawBox {
  // A zero dimension makes the contain-fit infinite. An image that failed to decode has
  // nothing to draw, so report an empty box rather than poisoning the canvas with NaN —
  // which paints nothing and reports no error.
  if (!(image.width > 0) || !(image.height > 0)) return { x: 0, y: 0, width: 0, height: 0 }

  const maxW = OG_CARD_WIDTH * (1 - INSET * 2)
  const maxH = OG_CARD_HEIGHT * (1 - INSET * 2)
  const scale = Math.min(maxW / image.width, maxH / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return {
    x: (OG_CARD_WIDTH - width) / 2,
    y: (OG_CARD_HEIGHT - height) / 2,
    width,
    height,
  }
}

/**
 * Paint the card. The PREVIEW and the EXPORT both call this, which is what makes "what
 * you see is the file that gets served" true by construction rather than by remembering
 * to keep two code paths in step (the same reason `drawFavicon` is shared).
 *
 * The background is filled FIRST and opaquely — that fill is the entire feature.
 */
export function drawOgCard(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  background: string,
): void {
  ctx.clearRect(0, 0, OG_CARD_WIDTH, OG_CARD_HEIGHT)
  ctx.fillStyle = ogBackgroundHex(background)
  ctx.fillRect(0, 0, OG_CARD_WIDTH, OG_CARD_HEIGHT)

  const box = ogCardDrawBox(image)
  if (box.width > 0 && box.height > 0) {
    ctx.drawImage(image, box.x, box.y, box.width, box.height)
  }
}
