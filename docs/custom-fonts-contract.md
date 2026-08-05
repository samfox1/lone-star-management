# Custom fonts — what the payload now carries, and what skeen renders

For the skeen side. Live as of 2026-08-05 (migration `20260805160000`): managers can
upload font files on the Brand page, assign a primary and a secondary, and pick any
uploaded font per region in the visual editor. All of it is publish-gated.

## The payload change, in one line

`get_public_site` (and the editor's `init-data` draft) gains one key:

```jsonc
"fonts": [
  {
    "family": "archivo-narrow",       // sanitized CSS token — [a-z0-9-] only, ≤32 chars
    "label":  "Archivo Narrow",       // what the manager typed, for UI only
    "path":   "<artist_id>/fonts/<uuid>.woff2",
    "format": "woff2",                // one of woff2 | woff | ttf | otf
    "role":   "primary"               // "primary" | "secondary" | null
  }
]
```

`[]` when the artist has no fonts. **Absent entirely on any revision published before
`20260805160000`** — read it with `?? []`, the same rule as every other key you've
adopted mid-flight.

## What to render

1. **@font-face + a utility class per font.** Resolve `path` against YOUR Supabase URL
   the same way you resolve media paths: `<supabase>/storage/v1/object/public/fonts/<path>`.
   For each font emit:

   ```css
   @font-face {
     font-family: '<family>';
     src: url('<resolved>') format('woff2' | 'woff' | 'truetype' | 'opentype');
     font-display: swap;
   }
   .font-<family> { font-family: '<family>', sans-serif; }
   ```

   The `.font-<family>` class is LOAD-BEARING: per-region overrides arrive in the
   `styles` map you already render as class strings (e.g. `"font-archivo-narrow"`), and
   without the class the override silently no-ops — the same trap as an uncompiled
   manifest token.

2. **Roles.** `role: "primary"` = headings, `role: "secondary"` = body text. On our
   built-in templates that's literally `h1..h6 { font-family: '<primary>', sans-serif }`
   and `body { font-family: '<secondary>', sans-serif }`, plus
   `:root { --font-primary: '<family>'; --font-secondary: '<family>' }` if you'd rather
   consume variables than element rules. Either is fine — pick what fits your CSS. At
   most one of each role can exist (DB-enforced).

3. **Precedence is the plain cascade.** Region override (`.font-x`, a class) beats the
   heading rule (element) beats body inheritance. Don't add `!important` or id
   selectors to any of these rules or you'll invert the manager's expectations.

## Safety — what you can rely on, and the one thing you must not do

- `family` is sanitized server-side to `^[a-z0-9]+(-[a-z0-9]+)*$` and re-sanitized at
  every emitter on our side. Tailwind-reserved names (`bold`, `sans`, `mono`, …) are
  never issued, so `.font-<family>` cannot collide with your compiled utilities.
- `format` is a closed enum; the bucket only accepts those four types and refuses
  `image/svg+xml` outright (an SVG "font" is a script vector).
- **Do NOT interpolate `label` into CSS or HTML attributes.** It is raw manager text,
  safe only as React-escaped text content. `family` is the token; `label` is display.
- If you build the CSS string yourself rather than using the shapes above, treat
  `family` as the only value that may enter a selector or `font-family`, and resolve
  `path` only under `/storage/v1/object/public/fonts/`.

## Editor behaviour you'll see

Your manifest's own font tokens (`font-momo`) keep working and keep list precedence in
the dropdown; uploaded fonts appear after them. If a manager picks an uploaded font for
a region, the class arrives in `styles` like any other token — you render it; the
`@font-face` you emitted makes it resolve. Nothing else about the bridge changed:
same `init-data` shape plus the one new key, same version (`v` unchanged — additive
keys don't bump the protocol).

## Retention

Font files live in the public `fonts` bucket and are garbage-collected only when no
working row AND no live published revision references them — a font your published site
uses keeps its file even after the manager deletes it from the Brand page, until the
next publish stops referencing it. No action needed on your side; noted so a cached
`@font-face` URL going 404 right after a publish is understood as intended, not a bug.
