# Site-bridge portability review — 2026-08-06

**The question (Sam):** is the editor↔site architecture a long-term, sustainable solution
for MORE websites? When the next site connects, is the bridge doable — and can lone-star
pick up specific UI elements and modify them?

**The verdict:** the architecture is right; the packaging is not. Everything that makes
this work — the typed versioned protocol, the manifest the site announces, the marker
vocabulary, the draft handed over `init-data` — was designed site-agnostic, and mostly is.
What makes it a ONE-site system today is that the site's half of the contract exists only
as hand-written code inside skeen (~60 exports across four modules), mirrored from
lone-star by eye. Site #2 means copying skeen and hoping; site #3 means three copies
drifting independently. The work is **extraction and declaration, not redesign**.

---

## What is already right (do not touch)

1. **The protocol** (`src/lib/site-editor/bridge.ts`). Typed messages, `source`
   discrimination, versioned with ≤-acceptance (a bump degrades to "one message ignored"
   instead of killing the handshake), two-way hello/ready so neither mount order loses,
   origin pinned on both sides, additive by policy. Every failure mode in this file was
   *earned* — the comments record real incidents. This is the portable core.
2. **The manifest is the site's own voice** (D-D). Fields, slots, style regions, link
   regions, components, styleOptions, assetBudgets — the SITE declares what is editable
   and lone-star renders panels from the declaration. This is exactly the multi-site
   architecture. Custom sites announce it on `ready`; nothing per-site ships in lone-star
   *in principle* (violations below).
3. **The marker vocabulary.** Five attributes, one meaning each (`field`, `item`, `slot`,
   `style`, `link`), a documented priority in `targetOf`, plus `data-lse-text` for
   DOM-derived text discovery and (new) `data-lse-shield` for iframes. Public site ships
   no editor furniture (the field attr rides along by design — it is the discovery scan).
4. **`init-data`**: the frame renders the manager's draft with no DB access of its own.
   The wire shape is the raw payload (paths, not resolved URLs) so a cross-origin site
   resolves media against its own Supabase URL.
5. **Text-from-DOM**: a site's `<Text field=…>` wrappers ARE the field list — no second
   bookkeeping to drift, defaults are the rendered words.
6. **The select router** (2026-08-06) is table-driven on a generic asset vocabulary
   (`track/video/image/merch/tour_date/link`); highlight is the same target mirrored
   back. Nothing skeen-specific in the mechanism.

## The gaps, ranked by what they cost site #2

### 1. The contract is hand-mirrored across two repos — extract an SDK
skeen re-implements: the protocol (`lib/frameBridge.ts`, 18 exports), the markers
(`editMarkers.ts`), the region/style resolution (`styles.ts`, 20 exports), the edit-list
types (`editList.ts`), and the payload type (`PublicSite` in `backend.ts` mirroring
`PublicSitePayload` in `site.ts`). This has already produced one real incident (the
version-bump lockout the ≤-acceptance rule was added for). Every new site multiplies it.

**Fix:** a frame-side SDK package — `@lone-star/site-bridge` — owned by this repo
(workspace precedent: `packages/music-rules`). Contents: protocol types + guards +
`mountFrameBridge`, marker helpers (`fieldAttr/itemProps/slotProps/linkProps`), region
style resolution (`resolveRegionStyle`/`regionProps`), the edit-list + payload types, the
highlight CSS snippet, and a `validateEditList()` so a malformed manifest fails loudly at
announce instead of rendering "0 regions". skeen migrates first — deleting its mirrors is
the proof the package is complete. Connecting site #N then reads: install the package,
wrap your strings in `<Text>`, mark your items/slots, declare your edit list, serve
`/edit`.

*Caveat to carry over: the npm-workspace symlink is why `packages/music-rules` is
excluded from Stryker's mutate list (see stryker.config.json). A new package inherits
that blind spot until the resolution issue is fixed.*

### 2. Video slots are hardcoded skeen, inside lone-star
`SiteVideoRole = 'hero_landscape' | 'hero_portrait' | 'bio_background'` is a skeen design
decision living in lone-star's types, actions and Videos panel; `SLOT_LABELS` says
"Landing page / Landscape · desktop"; `BAND_SLOTS = 2` is skeen's band layout. A site
with one background clip, or four embeds, or none, does not fit this panel.

**Fix:** declare video slots in the manifest like image components already are —
`videoSlots: [{ key, label, group, accepts: 'uploaded' | 'embed' }]` — and render the
panel from the declaration. `assignHeroSlotAction` validates against the artist's
manifest rather than a hardcoded union.

### 3. Gallery geometry is hardcoded skeen
`SLOTS_PER_ORIENTATION = 3` "matches skeen's collage". Another site's gallery may hold
five, or not be orientation-grouped at all. Belongs in the manifest next to components.

### 4. The Style panel's Tailwind contract is real but unstated
Style controls emit Tailwind utility strings (the clamp size ladder, weights, tracking,
arbitrary-value colours), and the site must be Tailwind, must compile/safelist those
exact shapes, and declares only colours/fonts via `styleOptions`. That is a fine
constraint — but it is currently discoverable only by reading `style-controls.ts`.
**State it as tiers** in the integration doc: Tier 1 (content: fields/slots/items/links —
no CSS framework requirement at all) and Tier 2 (the Style panel — Tailwind contract).

### 5. Convention-by-comment
The conventions a new site must know exist only in code comments and commit messages,
split across two repos: role shape `<component>_<n>_<slot>`; item-region keys
(`slot:<role>`, `video:<id>`); music tile = FIRST track's row id; hero clip = `mediaId`
on the section (because overlays swallow clip clicks); socials = lowercased-label join;
iframes need the shield; one-element-per-style-key. None of this is guessable.

**Fix:** `SITE_INTEGRATION.md` — the connect-a-site checklist and contract reference,
versioned with the SDK.

### 6. The socials label-join is the weakest contract (accepted, flagged)
`item:link:<label lowercased>` works because skeen's own `LABEL_TO_KEY` pipeline already
joins on labels — but rename "Instagram" to "IG" on the artist page and both the select
AND the site's own social mapping stop matching (the second half is pre-existing).
Longer term socials want bind-by-key roles like the declared link regions. Not urgent;
do not build more on labels.

### 7. Duplicate item markers (minor)
Socials render the same `item:link:*` marker in hero and footer; `highlight` outlines the
first match. Harmless today — make "first match wins" an SDK-documented rule rather than
an accident of `querySelector`.

## Sequenced plan

| Phase | What | Size |
| --- | --- | --- |
| 1 | Extract `@lone-star/site-bridge`; skeen deletes its mirrors and imports; shared contract fixtures pinned by tests on both sides | L — the load-bearing one |
| 2 | Declare video slots + gallery geometry in the manifest; delete the hardcoded unions/labels/counts from panels and actions | M |
| 3 | `SITE_INTEGRATION.md` + `validateEditList()` in the SDK | S |
| 4 | Socials bind-by-key (with skeen's existing role transition) | S, later |

Phase 1 before any site #2 conversation — it is the difference between "install and mark
up your DOM" and "read two repos and mirror them". Phases 2–3 can land alongside.
