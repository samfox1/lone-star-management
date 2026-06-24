# Phase 0 — Versioning foundation (buildable spec)

The gate for the whole restructure (`DASHBOARD_PLAN.md` §6). Scope is **backend
only**: make the profile + media draft→publish like content, with the **existing
dashboard still fully working** (its current "Publish" button ships profile +
media too). NO sidebar restructure here — that's Phase 1 — so there is no broken
intermediate state.

Decision locked (DASHBOARD_PLAN §4.1): all fan-visible artist fields
(`name, bio, hero_image_url, template, spotify_artist_id`) are **content**,
versioned as one `entity_type='artist'` snapshot; `slug` stays live; integration
config is never public. A site is live once its profile is published once.

TDD: every test below is written **first and watched fail (Red)**, then the
minimum migration/code to pass (Green). Real hosted DB, Node 22, sequential.

---

## A. Migrations

**A1. Widen the revisions CHECK** *(addresses §9 "CHECK migrations missing")*
`revisions.entity_type` is `('artist','track','tour_date','merch','link')` —
`'artist'` is already allowed; **add `'media'`**. (`'video'` waits for Phase 4.)

**A2. Rewrite `get_public_site`** *(addresses §9 "to_jsonb split", "config-field
leak", "media branch")* — base it on the LATEST definition in
`…140000_media_storage.sql` (NOT the older 094000):
- `artist` object: hand-built. `id`, `slug` from the **live** `artists` row
  (lookup keys); the content fields (`name, bio, hero_image_url, template,
  spotify_artist_id`) from the **latest non-tombstone `entity_type='artist'`
  revision's `data`**. **If no published artist revision exists → return `null`**
  (site not live → `/[slug]` 404s).
- `media`: from `entity_type='media'` revisions (latest per `entity_id`, drop
  `{_deleted}` tombstones), each `data = {purpose, path}`, ordered by
  `(data->>'sort_order')::int`. Delete the old live `public.media` join.
- tracks/tour/merch/links: unchanged.
- **Never `to_jsonb(artists)` / `select *`** into the payload — the artist
  snapshot is an explicit allowlist (see B1), so `shopify_domain`/`bandsintown_name`
  cannot ride along.

**A3. Backfill** *(addresses §9 🔴 "backfill mandatory — else live sites break")*
In the **same migration/transaction**, for every existing artist:
- insert one `entity_type='artist'` revision, `entity_id = artist.id`,
  `data = {name, bio, hero_image_url, template, spotify_artist_id}` from the live
  row;
- insert one `entity_type='media'` revision per existing `media` row,
  `entity_id = media.id`, `data = {purpose, path:storage_path, sort_order}`.
So the cutover is a no-op for every currently-live site (Skeen included).

---

## B. Code (`src/lib/content.ts`, `src/lib/site.ts`, dashboard publish)

**B1. `publishProfile(supabase, artistId, publishedBy?)` — singleton publish**
*(addresses §9 🟠 "two publish shapes" + "config-field leak")*
Read the artist's content columns via an **allowlist**
(`['name','bio','hero_image_url','template','spotify_artist_id']`) and insert ONE
`entity_type='artist'` revision. No tombstone (singleton). Mirror `publicSnapshot`
so the allowlist is the only thing reaching the public path.

**B2. Media into the reconcile registry** *(addresses §9 🔴 "media versioning")*
Add `media` to `ENTITIES` (table `media`, snapshot `['id','purpose','storage_path','sort_order']`,
orderBy `['sort_order']`) with `entity_id = media.id`, so the existing
`publishContent` reconcile loop (snapshots + `{_deleted}` tombstones) covers it.

**B3. Extend the publish path** *(keeps the existing UI working — no broken state)*
`publishAll` (and the dashboard `publishAction`) now also calls `publishProfile`
+ `publishContent('media', …)`. The existing dashboard "Publish" button thus
ships profile + media. The existing edit actions (template picker, Spotify-id
save, media uploader/delete) already write the working row — after A2 they become
**drafts** shown only in Preview until Publish. No change needed to those actions.

**B4. `getPublishedSite` / `getWorkingSite`** *(addresses §9 🟠 "preview parity")*
- `getPublishedSite` maps the rpc media (already `{purpose, path}`) — unchanged
  shape; but now returns `null` when the profile is unpublished (A2).
- `getWorkingSite` (Preview) keeps reading **live** working rows + the live `media`
  table (that IS the draft) — confirm it does NOT route through revisions.
- Both must emit the identical `SiteData` shape + ordering so Preview == live
  after a full publish.

**Note (§9 🟡):** media draft is *reference-level* — the `media` bucket is public,
so an unpublished hero video is still fetchable by URL, just not *referenced* by
the published site. Document; not a Phase-0 blocker.

---

## C. Tests (write FIRST — these are the Red→Green order)

1. `tests/publish-profile.test.ts` — **starts RED today.** Edit bio (working row)
   → `get_public_site` unchanged → `getWorkingSite` (preview) shows it → after
   `publishProfile`/publishAll → public shows it. Repeat asserting `template` and
   `spotify_artist_id` also wait for publish.
2. `tests/publish-media.test.ts` — same contract for media (upload → not
   referenced by public until publish → preview shows it → publish → live →
   delete + publish → gone via tombstone).
3. `tests/backfill.test.ts` — after the migration, `get_public_site('skeen')`
   returns his current name/bio/template/spotify_artist_id/media (byte-identical
   to pre-migration). Guards §9 🔴.
4. `tests/public-read.isolation.test.ts` — **UPDATE existing.** Artist object now
   from the published revision; assert exact key set (`id, slug, name, bio,
   hero_image_url, template, spotify_artist_id`), assert `shopify_domain` /
   `bandsintown_name` / `secret_ref` absent (the config-leak gate), and assert an
   artist with **no published profile → `get_public_site` returns null**.
5. `tests/preview-parity.test.ts` — after a full publish, `getWorkingSite(id)`
   deep-equals `getPublishedSite(slug)` for artist + media + content. The canary
   for the refactor.
6. `tests/publish-sections.test.ts` — publishing only `tracks` does NOT publish a
   pending profile/media edit (per-section isolation at the lib level). (The
   per-section UI + `diffUnpublished` + dirty badges are **Phase 1**.)

Regression guard: the full suite (121) stays green; #4 is the canary for any
`get_public_site` change.

---

## E. Definition of Done — how we PROVE a phase is complete

You know a concern is addressed because **it has a named test that is green** —
not because someone says so. A phase is "Done" only when ALL of:

1. **Every concern in the phase's checklist has a green, named test** (the test is
   the proof). A concern that can't be a test (e.g. "documented") gets an explicit
   artifact + a ticked box — never an unticked one.
2. **Full suite green** — no regressions; the test count only grows. The
   public-read isolation test is the security canary.
3. **`tsc --noEmit` clean + `npm run build` clean.**
4. **Live smoke check** of the user-visible behavior (e.g. Skeen's published site
   renders unchanged; the existing Publish flow still works).
5. **Diff reviewed** (`/code-review` on the change, like we've done each milestone).

The checklist below is the contract: the phase cannot be called done with any box
unchecked, and each box names the file that proves it.

### Phase 0 acceptance checklist (concern → proving test → status)
- [x] Backfill (no live-site regression) → `tests/backfill.test.ts` (3) + live smoke
- [x] Profile draft→publish (incl. template/spotify_id) → `tests/publish-profile.test.ts`
- [x] Media draft→publish + tombstone → `tests/publish-media.test.ts`
- [x] Config-field leak blocked + exact public key set → `tests/public-read.isolation.test.ts`;
      null-when-unpublished → `tests/publish-profile.test.ts`
- [x] Preview == live after publish → `tests/preview-parity.test.ts`
- [x] Per-section publish isolation → `tests/publish-sections.test.ts`
- [x] `'media'` CHECK accepted → proven by `publish-media.test.ts` (insert succeeds)
- [~] Existing dashboard Publish still ships everything → covered by tests
      (publishAll exercised in preview-parity); **final browser dogfood TODO**
- [x] Media-draft-is-reference-level → documented (B4 note)
- [x] Suite (131) + tsc + build green; diff reviewed pending

---

## D. §9 concerns — where each is handled
| §9 concern | Phase | Here |
|---|---|---|
| 🔴 Backfill or live sites break | 0 | A3 + test C3 |
| 🔴 Artist object = hand-built union (not `to_jsonb`) | 0 | A2 + field decision |
| 🔴 CHECK migration for `media` | 0 | A1 |
| 🟠 Two publish shapes (singleton + reconcile) | 0 | B1, B2, B3 |
| 🟠 Config-field leak (allowlist snapshot) | 0 | B1 + test C4 |
| 🟠 Preview/live parity | 0 | B4 + test C5 |
| 🟡 Broken intermediate state | 0 | scope = backend only; existing UI keeps working (B3) |
| 🟡 Media draft is reference-level | 0 | documented (B4 note) |
| Stale-migration citation | 0 | A2 (base on 140000) |
| `diffUnpublished`, dirty badges, sidebar, per-section publish UI, keep "Publish all" | **1** | DASHBOARD_PLAN §9 |
| site_content XSS, template field-schema | **1** | §9 |
| catalog-source switch semantics, Apple/Deezer-demote | **2** | §9 |
| gated-audio `sign_audio()` SECURITY DEFINER, TTL ≥ track len, bucket private | **3** | §9 |
| Apple/Ticketmaster/YouTube clients, source CHECK migrations, `'video'` CHECK | **4** | §9 |
| `analytics_events` anon write via `record_event()` | **5** | §9 |
