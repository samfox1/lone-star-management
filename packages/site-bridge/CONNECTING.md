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
| `--lse-icon-size` | Icon size | `width: var(--lse-icon-size, 24px)` |
| `--lse-hover-color` | Hover colour | `hover:text-[var(--lse-hover-color,#c63a2a)]` |
| `--lse-enter-duration` | Entrance speed | `animation-duration: var(--lse-enter-duration, 1.2s)` |
| `--lse-enter-distance` | Entrance travel | `translateY(var(--lse-enter-distance, 28px))` |

**This is the pattern the contract is moving toward for everything.** A variable keeps
your site in charge: the editor supplies a number, and you decide how it behaves at every
screen size.

```css
/* the manager picks a size; the site still shrinks it on a phone */
font-size: var(--lse-size, 2rem);
@media (max-width: 640px) { font-size: calc(var(--lse-size, 2rem) * 0.8); }
```

Today most other controls still write classes or inline values, which override your
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
silent bug.

1. **No editor furniture on the public page** — no marker attribute survives to a fan.
   Assert the positive too, or a component rendering nothing passes.
2. **Every declared key is marked in the markup.** For a site that mounts sections
   conditionally, walk them: the union is the real page.
3. **The self-audit passes**: `expect(auditRegions(list.styles, palette)).toEqual([])`.
4. **An empty payload renders empty states**, never invented content.
5. **Editor-set variables reach the element** they are supposed to reach.

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
- **Class-writing controls beat your breakpoints.** Until they become variables, keep base
  values fluid.
