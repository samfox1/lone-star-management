/**
 * INDEXNOW: the key file a connected site serves, so a Publish can tell Bing (and Yandex,
 * Naver, Seznam) which pages changed (site-bridge 0.42.0, AI_VISIBILITY_AUDIT finding 1.4).
 * Bing's index is what Copilot and ChatGPT search read.
 *
 * How it fits together:
 *   1. lone-star writes one random key per artist into a RESERVED `site_content` key
 *      (`INDEXNOW_CONTENT_KEY`). Only the system writes it; the editor's field paths refuse
 *      it. It publishes with the site text and rides the payload's open `site_content` map,
 *      so the published door did not change.
 *   2. The site serves it at `INDEXNOW_KEY_PATH` with `indexNowKeyFile(payload)`: one route
 *      file (CONNECTING.md §10).
 *   3. After a Publish, lone-star checks that file (the key AND the bridge version it
 *      reports) and only then POSTs the site's pages to api.indexnow.org, naming the file
 *      as `keyLocation`. The engines fetch it to confirm the ping came from the site's owner.
 *
 * The file sits at the ROOT on purpose. IndexNow scopes a key file to its own directory
 * (`/catalog/key.txt` vouches only for `/catalog/*`), so a root file covers every page.
 *
 * The one rule here: a value that is not an IndexNow key is NEVER served. This is a public
 * response on the artist's own domain, built from a payload value; without the shape check
 * the file would be a place to put any text (or html) on that domain.
 *
 * Pure: no DOM, no fetch, no clock. `Response` is the web-standard one, so the answer drops
 * straight into a Next route handler (or any framework that speaks Request/Response).
 */
import { PACKAGE_VERSION } from './manifest'

/** The `site_content` key the key rides in. Reserved in lone-star: only the system writes it. */
export const INDEXNOW_CONTENT_KEY = 'indexnow_key'

/** Where a site serves the key file, and what lone-star names as `keyLocation`. */
export const INDEXNOW_KEY_PATH = '/indexnow.txt'

/** The header the key file reports its bridge version in. lone-star reads it before a ping,
 *  the way the editor reads a manifest's `bridgeVersion`: a server has no manifest. */
export const INDEXNOW_VERSION_HEADER = 'x-site-bridge-version'

/** The protocol's key shape: 8 to 128 characters of a-z, A-Z, 0-9 and `-`. Nothing else. */
const KEY_SHAPE = /^[a-zA-Z0-9-]{8,128}$/

export function isIndexNowKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_SHAPE.test(value)
}

/** Anything with the payload's `site_content` map: the full `PublicSitePayload`, or null
 *  when the site is unconfigured or unpublished. */
type WithSiteContent = { site_content?: Record<string, string | undefined> | null } | null | undefined

/** The published IndexNow key, or null when there is none or it is not a valid key. */
export function indexNowKey(payload: WithSiteContent): string | null {
  const value = payload?.site_content?.[INDEXNOW_CONTENT_KEY]
  return isIndexNowKey(value) ? value : null
}

/**
 * The whole answer for `GET /indexnow.txt`: 200 with exactly the key as UTF-8 plain text,
 * or 404 with an empty body. Serve it as it is: do not add to the body, and do not build
 * your own from the payload.
 *
 *   // app/indexnow.txt/route.ts
 *   export const revalidate = 60
 *   export async function GET() { return indexNowKeyFile(await getSite()) }
 */
export function indexNowKeyFile(payload: WithSiteContent): Response {
  const key = indexNowKey(payload)
  if (!key) return new Response(null, { status: 404 })
  return new Response(key, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // A search engine should read this file, never list it.
      'x-robots-tag': 'noindex',
      [INDEXNOW_VERSION_HEADER]: PACKAGE_VERSION,
    },
  })
}
