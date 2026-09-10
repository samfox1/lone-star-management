/**
 * "Test connection" — one page from the store, and a NAME for whatever went wrong.
 *
 * Connecting Shopify is the one step an artist's team does without us, and every way it
 * fails looks the same from the dashboard: no products. So the useful answer is never a
 * tick, it is WHICH door is shut — each one has a different fix, and three of the five
 * send you to a different screen.
 *
 * ONE PAGE. The caller passes a reader that fetches a single page (`getFirstPage`), not
 * `getProducts`. Proving a token works should not drag a 500-product catalogue over the
 * wire, and the manager only needs to recognise their own merch to know it is the right
 * store.
 *
 * READ-ONLY, ALWAYS. This writes no merch rows. "Pull merch" stays the separate,
 * deliberate act, so Test connection is safe to press as many times as you like.
 */
import type { ShopifyMerch } from './shopify'
import { ShopifyApiError } from './shopify'

/**
 * Every way connecting can fail, as a value — `probeAdvice` is a `Record` over it, so a
 * new member without a sentence to show the manager is a COMPILE error rather than a
 * blank panel (AGENTS.md rule 4).
 */
export const PROBE_FAILURES = [
  'not-connected',
  'bad-domain',
  'store-not-found',
  'bad-token',
  'scope-missing',
  'rate-limited',
  'unknown',
] as const

export type ProbeFailure = (typeof PROBE_FAILURES)[number]

/**
 * SUCCESS INCLUDES AN EMPTY LIST, and that is the load-bearing decision here.
 *
 * A store whose products are not published to this token's sales channel answers 200 with
 * `[]` — byte-identical to a genuinely empty store. Shopify gives us nothing to tell them
 * apart, so the probe does not guess: reaching the API at all is the proof that the domain
 * resolved, the token authenticated and the scope allowed the query. What the EMPTY list
 * means is a question for the manager, and the panel names both possibilities rather than
 * picking one.
 */
export type ShopifyProbe =
  | { ok: true; products: ShopifyMerch[] }
  | { ok: false; reason: ProbeFailure; detail: string }

/**
 * Which door is shut, from what the client threw.
 *
 * Read in order of how specific the evidence is. HTTP status first — it is unambiguous and
 * set by Shopify's edge, before any GraphQL runs. Then the GraphQL extension code. Then
 * message shapes, which are ours (the client writes them) and so are safe to match on,
 * unlike upstream prose.
 */
function classify(e: unknown): { reason: ProbeFailure; detail: string } {
  const detail = e instanceof Error ? e.message : String(e)

  if (e instanceof ShopifyApiError) {
    // 404: the shop does not exist at that domain. 401/403: it does, and this token is not
    // welcome. Two different screens to go and fix.
    if (e.status === 404) return { reason: 'store-not-found', detail }
    if (e.status === 401 || e.status === 403) return { reason: 'bad-token', detail }
    // A token that authenticates but lacks the product-listing scope. Storefront answers
    // 200 and puts this in the GraphQL errors, so no status tells us.
    if (e.code === 'ACCESS_DENIED') return { reason: 'scope-missing', detail }
  }
  // Matched on OUR OWN message, which the client owns, not on upstream text.
  if (/rate-limited after/i.test(detail)) return { reason: 'rate-limited', detail }
  if (/invalid shopify store domain/i.test(detail)) return { reason: 'bad-domain', detail }
  if (/not configured/i.test(detail)) return { reason: 'not-connected', detail }
  // Deliberately keeps the message. An unclassified failure with its own text on screen is
  // still actionable; "something went wrong" throws away the only clue there was.
  return { reason: 'unknown', detail }
}

export async function probeShopify(getFirstPage: () => Promise<ShopifyMerch[]>): Promise<ShopifyProbe> {
  try {
    return { ok: true, products: await getFirstPage() }
  } catch (e) {
    return { ok: false, ...classify(e) }
  }
}

/** What the manager reads, and what they should go and do about it. */
export type ProbeAdvice = { title: string; fix: string }

const ADVICE: Record<ProbeFailure, ProbeAdvice> = {
  'not-connected': {
    title: 'No store saved yet',
    fix: 'Enter your store domain and storefront access token above, then try again.',
  },
  'bad-domain': {
    title: 'That domain is not a Shopify store address',
    fix: 'Use the myshopify.com address, like your-store.myshopify.com — not your public shop domain. Shopify only answers the API on the myshopify.com one.',
  },
  'store-not-found': {
    title: 'No store at that address',
    fix: 'Check the spelling. Shopify Admin shows it under Settings → Domains as your .myshopify.com address.',
  },
  'bad-token': {
    title: 'The store is there, but the token was refused',
    fix: 'The token is wrong, or it was revoked. Make a new Storefront API access token in Shopify Admin and paste it again.',
  },
  'scope-missing': {
    title: 'The token works, but it is not allowed to read products',
    fix: 'In Shopify Admin, edit the app the token belongs to and tick unauthenticated_read_product_listings under Storefront API access scopes, then paste a fresh token.',
  },
  'rate-limited': {
    title: 'Shopify is busy',
    fix: 'Nothing is wrong with your setup. Wait a minute and press Test connection again.',
  },
  unknown: {
    title: 'Could not reach Shopify',
    fix: 'The exact message is below. If it mentions the network, try again; otherwise send it to us.',
  },
}

export function probeAdvice(reason: ProbeFailure): ProbeAdvice {
  return ADVICE[reason]
}

/**
 * The two things a preview should FLAG, both of which are silent otherwise.
 *
 * `buyable: false` — a product with no variants cannot be added to a cart at all, because
 * a cart line is built from a ProductVariant id. It renders on the site and refuses to
 * sell, which is the worst of both.
 *
 * The other, transparency, deliberately has NO flag: the panel renders these images on the
 * same near-black ground the real site uses, so a product shot with a white box baked in
 * shows up AS a white box. Seeing it beats being told about it, and detecting alpha would
 * mean decoding every image server-side.
 */
export function previewFlags(p: ShopifyMerch): { buyable: boolean } {
  return { buyable: p.variants.length > 0 }
}
