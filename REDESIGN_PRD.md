# Dashboard Redesign — PRD

Porting the `prototypes/lone_star_app_v9.html` design into the real app. This is a **presentation + IA redesign plus a new public/auth surface** — it does **not** touch the data layer, publish model, RLS, doors, integration clients, or the fan-facing site.

Status: draft for approval. No code until the open decisions in §8 are settled.

---

## 1. Goal

Replace today's two disconnected manager surfaces (a bare `/` artist list + a per-artist left-sidebar dashboard) with one cohesive, modern app:

- **Roster home** with a shared top-nav shell, grid/list, hover stats, and a **request-an-artist** flow.
- **Artist context**: clicking an artist re-scopes the top nav to that artist (avatar + name replace the wordmark), landing on **Analytics**, with Releases / Tour / Videos / Merch / Integrations / Edit.
- A **public marketing site + apply page** and real **sign-in / sign-up** before the app.
- A small **black-and-white design system** (Inter + Space Mono, restrained blue/red accents) applied across the manager surface.

## 2. Scope — what changes vs what stays

**Changes (presentation/IA + new public surface):**
- `src/app/page.tsx` (roster home), the `(dashboard)` layout/sidebar → top-nav shell, every `(dashboard)/*` section's JSX/styling, `settings`, `/login`.
- New routes: public marketing landing, apply, sign-up, auth callback.
- New design tokens + a few shared UI primitives.

**Stays untouched (hard line):**
- Publish model (`lib/content.ts`, `revisions`, working rows, `publishAll`, `diffUnpublished`).
- Public doors + `lib/site.ts` parity (`get_public_site` etc.), the fan-facing templates (`artist-site.tsx`, cinematic).
- RLS / `artist_managers` / `requireArtist` / `is_manager_of`.
- Integration clients (`lib/{spotify,apple,…}.ts`) and the server actions in `actions.ts` — we **re-skin and relocate** their UI, we don't rewrite the calls.

> Principle: this is a **re-skin + re-flow of existing server-rendered pages and server actions**, not a re-architecture. Keep every page a Server Component; keep mutations as the existing server actions.

## 3. Guardrails (must not break — verified in the codebase)

1. **Preview ↔ published parity** (`tests/preview-parity.test.ts`) and the single `SiteData` shape. Don't add a dashboard field that silently widens the public snapshot (`PUBLISHABLE[].snapshot` / `ARTIST_SNAPSHOT`).
2. **Tenant isolation / doors** (`*.isolation.test.ts`, ADR-0001). No new anon read paths; keep reads through RLS / doors.
3. **Auth protection is hardcoded** in `src/lib/supabase/middleware.ts` (`PROTECTED_EXACT=['/']`, `PROTECTED_PREFIXES=['/artists']`). Adding a **public** marketing/`/` page means moving `/` OUT of protected and adding the new app entry to protected — get this exactly right or we leak data / lock users out. (Middleware is `src/proxy.ts`, not `middleware.ts`.)
4. **Publish wiring**: `sections.ts` (`DIFF_SECTIONS`/`dirtyBySeg`) → dirty dots + the `(dashboard)/layout.tsx` action bar (Preview / View site / **Publish all**). Any nav restructure must keep this; keys are typed against `UnpublishedDiff`.
5. **`/artists/[id]/preview` lives OUTSIDE the `(dashboard)` group** — the new top-nav shell must not wrap it.
6. **Next-16 specifics**: `params`/`cookies()` are async (await them); Tailwind v4 is CSS-first (tokens go in `globals.css @theme`, no JS config).
7. Integration **sync still invokes the factory clients** via `actions.ts` (don't inline `fetch`).

## 4. Design system foundation (Phase 0)

- **Tokens** in `globals.css` `@theme`: ink `#111`, muted/faint greys, hairline `#ececec`, `--accent-blue #2563eb`, `--accent-red #e5484d`, paper white. Replace the dashboard's hardcoded `zinc-*` + `dark:` usage progressively (dashboard goes **light-only**; today it's zinc with dark variants).
- **Fonts** (`layout.tsx`): Inter is already loaded but not applied to `<body>` — apply it; **add Space Mono** via `next/font/google` for labels/numbers/handles (Geist Mono is current; Space Mono is the prototype's mono).
- **Primitives** (new `src/components/ui/`): `Button` (solid/ghost/icon), `Input`/`Textarea`, `Card`, `Stat`, `Sparkline`/`AreaChart` (inline SVG, as in the prototype), `Avatar`, `Icon` set (the prototype's stroke SVGs). These don't exist today (everything is ad-hoc inline Tailwind) — building them first stops the restyle from duplicating class strings.
- **Shell**: a top-nav `AppShell` (wordmark/brand that swaps to artist avatar+name in artist context, centered icon nav with hover labels, search + settings + avatar), used by roster home + artist context; mobile → fixed bottom tab bar at `<640px`.

## 5. Information architecture: prototype → real app

| Prototype | Real today | Plan |
|---|---|---|
| Marketing landing (public) | — (none) | **New** public route (e.g. `/welcome` or `/` once `/` app moves) |
| Apply for a site | — | **New** `/apply` (public) → `artist_requests` insert |
| Sign in / Sign up | `/login` only | Restyle `/login`; **add** sign-up + `/auth/callback` |
| Landing launcher (post-login) | — | Optional; could fold into roster home |
| Roster home | `/` (bare list) | Redesign `/` (grid/list, hover stats, Request artist) |
| Artist · Analytics (landing) | `/artists/[id]` = **Overview** (insights + unpublished list) | Make Analytics the artist index; fold "unpublished changes" into the shell's Publish bar |
| Artist · Releases | `releases/` **and** `tracks/` exist separately | **Decision (§8):** merge or keep both |
| Artist · Tour | `tour/` | Restyle |
| Artist · Videos | `videos/` | Restyle |
| Artist · Merch | `merch/` (already a content section) | Restyle |
| Artist · Integrations (per-artist hub) | scattered `SyncPanel`/`ShopifyPanel` on section pages + read-only `settings/` | **Consolidate** into one per-artist Integrations page (keep the same bound actions + `artists.*_id`/`integrations` model) |
| Artist · Edit (name/handle/bio/status) | parts live in `site/` + profile | Map to existing profile/site fields |
| (no prototype equivalent) | `links/`, `site/`, `epk/` | Keep as artist sections (prototype didn't cover them) |
| Account settings (Profile/Workspace/Plan) | — (per-artist `settings` only, stub) | **New** workspace-level settings (small) |

## 6. Backend additions needed (small, additive)

- **`artist_requests`** table `(id, requested_by, name, handle, link, email, notes, status, created_at)` + RLS (manager can insert/list own; admin sees all) + a server action. Powers both the in-app "Request artist" and the public "Apply" form. Public apply may insert via a SECURITY DEFINER fn or a route handler (since apply is pre-auth) — mirror the doors pattern.
- **Analytics data source** — see §8 risk. The prototype's per-artist "monthly listeners / streams / trend / sparkline" is **fabricated**; the app currently stores **site visit** analytics (`site-analytics`) and catalog counts, not streaming time-series. Either (a) scope Analytics to real data we have (site visits, release/track/video counts, last-sync), or (b) add ingestion + a metrics table. Decision needed.
- Sign-up + `/auth/callback` server actions (extend `auth-actions.ts`).

## 7. Phased delivery (each phase = its own PR on a branch off `dev`)

- **Phase 0 — Foundation:** tokens + fonts in `globals.css`/`layout.tsx`; `src/components/ui/*` primitives; `AppShell` top-nav (no behavior change to data). Ship behind the existing pages first.
- **Phase 1 — Roster home + request:** redesign `/`; `artist_requests` table + action; Request-artist modal + pending state. (Self-contained, low risk.)
- **Phase 2 — Artist context:** convert the per-artist sidebar to the artist-scoped top nav; Analytics as index; restyle Releases/Tracks, Tour, Videos, Merch; **Integrations hub** (relocate SyncPanel/Shopify UI, same actions); Edit. Preserve the Publish action bar + dirty dots. (Biggest phase.)
- **Phase 3 — Public + auth:** marketing landing, `/apply`, sign-up, `/auth/callback`; update `proxy.ts` protection list carefully; restyle `/login`.

## 8. Open decisions (need Sam's input before/at kickoff)

1. **Analytics data** — biggest one. Do we (a) scope the Analytics page to data we actually have now (site visits, catalog/release/video counts, last-sync, on-tour), shipping the rich streaming charts as "coming soon", or (b) invest in streaming-metrics ingestion (store monthly listeners/streams over time) so the charts are real? (a) is far cheaper and unblocks the redesign.
2. **Releases vs Tracks** — the app separates `tracks/` (catalog/audio) from `releases/` (DSP smart-links). The prototype showed only "Releases." Merge into one section, or keep both in the artist nav?
3. **Links / Site / EPK** — keep these as artist sections in the new nav (they have no prototype design yet), or rethink? Recommend: keep, restyle as-is for now.
4. **Public entry URL** — does the app move to `app.` / a subpath so `/` can be the marketing page, or keep `/` as the app and put marketing at `/welcome`? Affects the `proxy.ts` change.
5. **Sign-up open or invite-only?** Product framing is single-manager/high-touch (you build sites). Should public sign-up exist at all, or is the public surface "Apply" only, with accounts provisioned by you?

## 9. Testing

- Keep all existing integration/isolation/parity tests green (they're data-layer; a re-skin shouldn't touch them — run the suite after each phase). Note: tests hit the **live Supabase project** (no `.env.test` reset here).
- Add light **render tests** for the new shell + roster (currently zero `src/app/**` UI tests).
- New `artist_requests` gets its own RLS/isolation test, matching the existing `*.isolation.test.ts` pattern.

## 10. Explicitly out of scope

Fan-facing templates (`artist-site.tsx`, cinematic), the publish/revisions internals, RLS/doors, the integration client internals, and the Bandsintown compliance work (still blocked). Roles/multi-manager UI stays deferred (data model is already M:N, but UI assumes single manager).
