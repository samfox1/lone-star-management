/**
 * URL sanitization for any href/src that originates from untrusted input
 * (manager-entered today; Shopify/Bandsintown syncs tomorrow). These render on
 * the public, fan-facing site, so a `javascript:` or `data:text/html` URL would
 * be a stored-XSS sink on click. Render-time sanitization is the must-have
 * guard (it also protects rows that predate validation or arrive via sync).
 *
 * safeHref returns a safe href string, or `undefined` when the URL is unsafe —
 * callers treat `undefined` as "not a link" and render plain text.
 */

/** Schemes allowed on a public link. mailto/tel matter for booking/contact. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Browsers ignore ASCII whitespace/control chars embedded in the scheme token,
 * so `java\tscript:` and `  javascript:` both execute. Strip every C0 control
 * char (U+0000–U+001F), space, and DEL (U+007F) before inspecting the scheme —
 * matching what the browser collapses, not just the visible string.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_AND_SPACE = new RegExp('[\\u0000-\\u0020\\u007f]', 'g')

export function safeHref(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined

  const trimmed = url.trim()
  if (trimmed === '') return undefined

  // Anchors and relative paths have no scheme and cannot be javascript:.
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed

  const collapsed = trimmed.replace(CONTROL_AND_SPACE, '')
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(collapsed)

  // No scheme => relative URL (e.g. "shop", "example.com/x"). Safe to keep.
  if (!schemeMatch) return trimmed

  const scheme = schemeMatch[1].toLowerCase()
  if (!SAFE_SCHEMES.has(scheme)) return undefined

  return trimmed
}

/** Columns whose values are rendered as an href/src on the public site. */
const URL_FIELDS = new Set([
  'url',
  'stream_url',
  'ticket_url',
  'cover_url',
  'image_url',
  'hero_image_url',
])

/** True if `field` holds a URL we must validate before persisting. */
export function isUrlField(field: string): boolean {
  return URL_FIELDS.has(field)
}
