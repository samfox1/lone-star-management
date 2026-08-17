# Connecting a site to the Lone Star editor

The contract a website follows so a manager can edit it from Lone Star.

It ships with the package a site installs, so the rules and the code that enforces them
travel together and are versioned together. If this document and the package disagree,
the package is right and this is a bug.

Everything here was learned by connecting three sites: **skeen** (custom, built before
the editor existed), **juniper** (a light editorial page) and **operator** (a tabbed
console that mounts one section at a time). Most rules exist because breaking them
produced a control that looked fine and did nothing.

---

## The one principle

> **The editor supplies values. The site owns presentation.**

The editor never decides how something looks at 400px versus 1400px, never decides what
`font-serif` resolves to, and never decides where an element sits. It supplies a number,
a colour, a string. The site decides what that means.

Every problem worth fixing in the first three sites came from breaking this: the editor
overwriting a site's whole class list, or reading a colour it was never told about.

Two consequences to keep in mind while building:

- A site can be as editable or as locked-down as it likes. It offers what it declares
  and nothing else, so a bespoke page exposing three regions and a template exposing
  forty are the same shape to the editor.
- Responsiveness stays yours. The editor is not allowed to have an opinion about
  breakpoints, and a site should never surrender that authority to it.

---

## 1. Install and bind, once

```ts
import { bindSiteRegistry } from '@samfox1/site-bridge/bind'

export const REGIONS = { hero: 'grid gap-8 py-16', /* … */ } as const
export function regionBase(key: string): string {
  return REGIONS[key as keyof typeof REGIONS] ?? ''
}
export const { regionProps, splitItemProps, mountFrameBridge } = bindSiteRegistry({ regionBase })
```

`regionBase` returns `''` for a key it does not know, rather than throwing. A manifest
naming a region a later build dropped should render unstyled, never crash a fan's page.

Bind **once**. The render path and the edit-frame mount then read the same registry by
construction rather than by two people remembering.

---

## 2. Declare what is editable

The editor renders its panels from the manifest your site announces. Nothing about your
site is known to Lone Star; if it is not declared, it does not exist.

| Declaration | What it gives the manager |
| --- | --- |
| `styles[]` | A region they can restyle |
| `fields[]` | Text or an image they can change |
| `slots[]` | A section that holds library items (songs, shows, videos) |
| `links[]` | A button whose URL they can set, bound **by key** |
| `styleOptions` | Your palette and typefaces, so the editor can offer real choices |

Also send `bridgeVersion: PACKAGE_VERSION`, so the editor can tell a manager when the
deployed site is older than the controls being offered.

### Scopes decide where a region appears

| `scope` | Where it appears | What it gets |
| --- | --- | --- |
| `'site'` | Listed in the Style tab | Surface controls; width if the base caps one; spacing if the base sets vertical padding |
| `'chrome'` | Listed in the Style tab | The above plus bar geometry (width, height, divider) |
| `'icons'` | Listed in the Style tab | The icon-group set: size, colour, hover colour, gap |
| `'item'` | Never listed | Click-to-edit only; its words belong to a library panel |
| *(absent)* | Never listed | Click-to-edit only |

Declare only the surfaces you actually have. A site with no footer declares no footer
region, and the panel simply does not show one. The panel reads the same across sites
because every site describes itself the same way, not because every site is the same.

---

## 3. Mark the elements

| Attribute | Goes on |
| --- | --- |
| `data-lse-style` | A styleable region |
| `data-lse-field` | One editable value (a line of text, one image) |
| `data-lse-text` | Text discoverable from the DOM |
| `data-lse-slot` | A container holding library items |
| `data-lse-item` | One library item inside a slot |
| `data-lse-link` | An `<a>` whose href is editable by key |

The helpers emit these **only in edit mode**, so a public page carries no editor
furniture. Test both directions: that a fan sees none, and that edit mode has them all.
A component rendering nothing would pass the first assertion on its own.

> **Every declared key must be marked somewhere in the markup.** A region the manifest
> declares and the page never marks gives the manager a control that changes nothing,
> with no error anywhere. This is the single most common way to break the connection, and
> it is silent. Test it.

---

## 4. Declare what you set, or the editor cannot show it

A control reads its region's class string and nothing else. A value living on a child
element, in a CSS fallback, or in a class your palette never declared leaves the control
blank while the page is plainly styled.

This caused five separate bugs across the first three sites. It is the rule most worth
internalising.

```ts
// WRONG — the row is coloured and sized, and every control opens blank
socials: 'flex gap-4'
// …with `text-white/80` and `h-6 w-6` hidden on each child <a>

// RIGHT — the row declares what it is
socials: 'flex gap-4 iconsize-[18px] text-ink/60 hovercolor-[#9c4221]'
// …and the children inherit (currentColor) rather than setting their own
```

Concretely:

- **Sizes and gaps a slider should open on** go in the base (`iconsize-[18px]`, `gap-4`,
  `py-12`). Without one the handle rests on a guess, and dragging can make something
  smaller when it should get bigger.
- **Colours** go in the base **and** in `styleOptions`. A picker recognises exactly two
  things: a colour your palette declares, and an arbitrary hex (`text-[#ffffffcc]`). Use
  the hex form for a colour with no palette entry.
- **Every opacity you actually use** is its own palette entry. `text-ink/60` being
  declared does nothing for `text-ink/70`.

`auditRegions` from `@samfox1/site-bridge/audit` checks this. Run it in your own test
suite (see §7).

---

## 5. Honour the editor's variables

Some controls set a CSS custom property on the region rather than a class. Your site
opts in by reading it, with your own default as the fallback:

| Variable | Set by | Read it like |
| --- | --- | --- |
| `--lse-size` | Font size | `font-size: var(--lse-size, 2rem)` |
| `--lse-font` | Font | `font-family: var(--lse-font, 'Momo Display', serif)` |
| `--lse-weight` | Boldness | `font-weight: var(--lse-weight, 700)` |
| `--lse-align` | Alignment | `text-align: var(--lse-align, center)` |
| `--lse-leading` | Line spacing | `line-height: var(--lse-leading, 1.25)` |
| `--lse-tracking` | Letter spacing | `letter-spacing: var(--lse-tracking, -0.02em)` |
| `--lse-case` | Uppercase | `text-transform: var(--lse-case, none)` |
| `--lse-fontstyle` | Italic | `font-style: var(--lse-fontstyle, normal)` |
| `--lse-size-m` | Font size · phone view | see *Mobile overrides* below |
| `--lse-pad-m` | Padding · phone view | see *Mobile overrides* below |
| `--lse-icon-size` | Icon size | `width: var(--lse-icon-size, 24px)` |
| `--lse-hover-color` | Hover colour | `hover:text-[var(--lse-hover-color,#c63a2a)]` |
| `--lse-enter-duration` | Entrance speed | `animation-duration: var(--lse-enter-duration, 1.2s)` |
| `--lse-enter-distance` | Entrance travel | `translateY(var(--lse-enter-distance, 28px))` |

**This is the pattern the contract is moving toward for everything.** A variable keeps
your site in charge: the editor supplies a number, and you decide how it behaves at every
screen size.

### Claiming a property

Size and font set their variable **and** the property itself, so a site that does nothing
renders exactly as it did when they were classes. Add `lse-owns-[…]` to a region's **base**
to take that authority back — the variable is still set, the property is not, and your own
rule decides:

```ts
hero_name: 'block lse-owns-[size]'   // any of: size, font, weight, align,
                                     // leading, tracking, case, italic
```

```css
.hero-name { font-size: var(--lse-size, clamp(4rem, 18vw, 11rem)); }
@media (max-width: 640px) { .hero-name { font-size: calc(var(--lse-size, 3rem) * 0.8); } }
```

Three things to know about the claim:

- It is read from the **base**, never the merged string, so it survives a manager styling
  the region (which replaces the base — see Known rough edges).
- Claims are **per property**. Owning size says nothing about font.
- The marker never reaches the rendered class list. It is a declaration, not CSS.

Declare your own fallback in every `var()`, and make it the value the region actually
wears. An unset variable falling back to nothing is a region that disappears.

### Mobile overrides (0.19.0)

Editing in the editor's **phone view** writes a second, phone-only value (`sizesm-[18px]`
→ `--lse-size-m`, `padsm-[12px]` → `--lse-pad-m`). Inline styles cannot express
`@media`, so on an UNCLAIMED region the element also gains a marker class
(`lse-msize` / `lse-mpad`) that the package's own tokens.css reads below 640px, with
`!important` so it beats the same element's inline desktop value.

A region that **claims** the property gets the variable only — no marker class, because
the package rule would beat your phone cap. Read it yourself, inside your own media
query, wherever you decide "mobile" begins:

```css
@media (max-width: 480px) {
  .hero-name { font-size: var(--lse-size-m, min(var(--lse-size, 3rem), 12vw)); }
}
```

The chain order matters: the manager's phone value if set — UNCAPPED, because an
explicit phone pick is them saying what they want on a phone — else the desktop value
under your cap, which exists to stop desktop-derived sizes overflowing small screens.

**Why discrete, not fluid (history):** 0.20 briefly fused the two picks into one clamp
interpolating 390→1024px. Elegant, wrong: every not-fullscreen laptop sat on the slope,
so the phone pick reached "desktop" widths. The two values are independent again — each
editor view edits exactly what it shows.


**Fonts must declare what they resolve to.** The editor cannot know what `font-momo`
means, so it keeps writing the class until you say:

```ts
fonts: [{ value: 'font-momo', label: 'Momo', css: '"Momo Display", serif' }]
```

Once declared, the editor sets `--lse-font` instead — nothing to safelist and nothing to
compile. Undeclared fonts keep working, so a site migrates one at a time.

Every other control still writes classes or inline values, which override your
breakpoints. Prefer fluid values (`clamp()`) in your bases so a manager's choice stays
responsive, and expect more of these to become variables.

---

## 6. Read your published content

```ts
import { fetchPublicSite } from '@samfox1/site-bridge/public-site'

export const revalidate = 60

export default async function Home() {
  const site = await fetchPublicSite({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    slug: process.env.NEXT_PUBLIC_ARTIST_SLUG,
  })
  return <SiteBody site={site} />
}
```

Without this the editor half works and publishing reaches nothing, with no error to
explain it. Two of the first three sites shipped in exactly that state.

**Never invent content.** An unconfigured or unpublished site renders its empty states.
A fallback the editor cannot edit is indistinguishable, from the manager's side, from a
broken binding: they click the thing the site is plainly showing and nothing happens.

Your `/edit` route must trust the editor's origin (`NEXT_PUBLIC_EDITOR_ORIGIN`, defaulting
to `http://localhost:3000`) or the bridge ignores every message and the preview looks
fine while doing nothing.

---

## 7. Tests a connected site must pass

These are the connection, not extras. Each one exists because its absence shipped a
silent bug — so they are **code, not a checklist**:

```ts
import { checkContract } from '@samfox1/site-bridge/contract'

it('passes the connection contract', () => {
  const full = aFullyPublishedSite()
  const snap = (el: Element) => el.cloneNode(true) as Element   // cleanup() empties it
  const publicDom = snap(render(<SiteBody site={full} />).container)
  cleanup()
  const live = render(<SiteBody site={full} editable />).container
  const editableDom = snap(live)
  cleanup()
  expect(checkContract({
    manifest: EDIT_LIST,
    publicDom,
    editableDom,
    emptyDom: snap(render(<SiteBody site={emptyPayload()} />).container),
    publishedValues: [full.config.instagram, full.bio[0]],
  })).toEqual([])
})
```

What it checks, and what each one is about:

1. **No editor furniture on the public page** — no marker attribute survives to a fan,
   *and* the editable render must carry some. Without that witness, a component rendering
   nothing passes perfectly.
2. **Every declared key is marked.** A control the manager can set that changes nothing,
   with no error anywhere. For a site that mounts sections conditionally, walk them: the
   union is the real page. A link that configures rather than renders declares
   `rendered: false` (§2).
3. **The self-audit passes** — delegated to `auditRegions`, so the two can never disagree
   about what "declare what you set" means.
4. **An empty payload invents nothing.** Pass `publishedValues`: strings that exist only
   because someone published them. None may appear when nothing is published.
5. **A claimed property arrives as a variable** and is never inlined over (§5).

Write this one test rather than one per component. skeen had five per-component versions
of rule 1, all passing, while every heading on its live site carried `data-lse-field` —
each asserted only over the markers its own component emits, and the leak came from one
none of them rendered.

---

## 8. Two kinds of site

The contract does not distinguish them. Both declare what they offer; the editor renders
exactly that.

- **A custom site** declares a handful of regions and locks the rest. A manager gets a
  small, safe set of controls and cannot pull the design apart.
- **A template site** declares broadly and hands over real control.

The difference is how much you declare, and nothing else. That is deliberate: one
mechanism, no second path to maintain, and a site can move along the scale later without
being rebuilt.

---

## 9. Versioning

The editor compares `bridgeVersion` against its own and warns a manager when the deployed
site is behind, because a newer editor can offer a control the older site cannot honour.

After publishing a bridge release, sites must be upgraded **and redeployed**. Vercel can
serve a cached build with the old package inside it, so verify the deployed bundle rather
than trusting the push.

---

## Known rough edges

Written down so nobody rediscovers them.

- **A section override replaces the base**, so a region a manager has styled is frozen at
  the design of that day and later improvements never reach it. Detectable
  (`driftedRegions`) and repairable (`npm run rebase:styles`), not yet impossible. The fix
  is storing only what the manager changed, which is what §5 is building toward.
- **Reset on a section control removes the property** rather than restoring your default,
  for the same reason.
- **Class-writing controls beat your breakpoints.** Size and font became variables in
  0.16.0, the six remaining text controls in 0.18.0 (§5). Palette colours still lift
  inline; keep base values fluid where a control has no variable yet.
- **Value tokens need 0.16.0 or newer** (the text families 0.18.0). An older applier renders `size-[48px]` as a dead
  class and the region falls back to its base size. The editor checks your `bridgeVersion`
  and keeps writing classes when you are behind, so upgrading is safe in either order —
  but a site that never stamps a version is treated as old and never gets them.
