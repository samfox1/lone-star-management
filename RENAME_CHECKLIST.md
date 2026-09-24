# Rename checklist

Mechanical. Everything below is find-and-replace or a one-line edit. Nothing here is
risky, and nothing here blocks the Resend work (see §0).

Placeholders used below:
- `NEWNAME` — the display name, e.g. `Greenroom`
- `newname` — the slug, e.g. `greenroom`

---

## 0. What does NOT need to wait for the name

The sending domain is **data, not code**: `mail_settings.sending_domain` (one row) with a
per-artist override in `artist_mail_settings.sending_domain`. Changing it later is: add
the domain in Resend, paste the DNS records, `update mail_settings set sending_domain=…`.
No migration, no deploy.

So the enquiry-forwarding work can start today. The only thing a later rename costs is
re-verifying one domain.

---

## 1. Published surfaces — check FIRST, before committing to a name

| Thing | Status today | Action |
| --- | --- | --- |
| `@samfox1/site-bridge` | **published**, consumed by 3 live sites | **No change.** Already name-neutral. Leave it. |
| `@lone-star/music-rules` | workspace-only (`"*"` / `file:`), never published | Safe to rename freely. |
| Supabase project | named separately | Optional cosmetic rename in the dashboard. |
| Vercel projects | separate per site | Optional. Renaming changes the `*.vercel.app` preview URL. |
| GitHub repo | `lone-star-management` | Renaming keeps redirects from the old URL. |

Before buying anything: check the `.com`, the USPTO trademark search, and that the handle
is free on Instagram and X. A name that is free on npm but taken on Instagram is a name
you will regret.

---

## 2. Code — user-visible strings (do these, they are the point)

34 `Lone Star` / 48 `lone-star` occurrences. Most are page titles.

- [ ] `src/app/layout.tsx:40` — root `title`
- [ ] Page metadata titles, all of the form `'X — Lone Star Management'`:
      `src/app/page.tsx`, `roster/page.tsx`, `apply/page.tsx`,
      `admin/applications/page.tsx`, `videos/page.tsx`, `book/page.tsx`,
      `tour/page.tsx`, `merch/page.tsx`, `artists/page.tsx`,
      `artists/[id]/(dashboard)/(manager-tools)/settings/page.tsx`, `…/connections/page.tsx`,
      `…/subscribers/page.tsx`
- [ ] `src/app/launcher.tsx:37` — the launcher wordmark
- [ ] `src/app/welcome/page.tsx:6,35,96` — title, wordmark, copyright
- [ ] `src/app/apply/page.tsx:11` — wordmark
- [ ] `src/app/roster-chrome.tsx:49` — the wordmark-suffix comment explains the
      `"Lone Star <page>"` pattern; update the comment with the code

The wordmark is `<span className="text-accent">★</span> Lone Star <b>Management</b>` in
two places. If the new name drops the star, both need a real edit, not a replace.

**Email copy — the only string a stranger reads:**
- [ ] `supabase/functions/contact/index.ts`, `composeText()`:
      `'— Sent from your Lone Star site contact form. Reply to this email to answer directly.'`
- [ ] Same file, attachment branch: `'Open the enquiry in Lone Star to listen or download.'`

---

## 3. Code — identifiers and config

- [ ] `package.json:2` — `"name": "lone-star-management"` → `"newname"`
- [ ] `packages/music-rules/package.json:2` — `@lone-star/music-rules` → `@newname/music-rules`
- [ ] `package.json:36` — the workspace dep key
- [ ] `next.config.ts:4,12` — `transpilePackages` entry + the comment above it
- [ ] `lone-star-agent/package.json:2,16` — own name + the `file:` dep
- [ ] `lone-star-agent/agent/lib/lonestar.ts:7,123` — import + comment
- [ ] `lone-star-agent/agent/lib/lonestar.ts` — consider renaming the file itself
- [ ] `lone-star-agent/` — the directory name
- [ ] `package-lock.json` × 2 — do NOT hand-edit. Delete and `npm install` after the
      package.json changes land.

**Env var** (edge function secret, not in code):
- [ ] `supabase/functions/contact/index.ts:62` — `LONE_STAR_APP_URL`
- [ ] If renamed, `supabase secrets set` the new key and unset the old one, or the
      dashboard link in every enquiry email silently disappears (the code falls back to
      "open Lone Star" prose with no link, which fails quietly — nobody notices a missing
      link in an email).

**Leave alone:**
- `docs/LONE_STAR_CHANGES.md` and the migration comment referencing it — a historical
  record, same reasoning as the plan docs in AGENTS.md.
- `tests/unit/shopify/shopify.test.ts:457` — `lone-star.myshopify.com` is a fixture
  string, not a brand reference.

---

## 4. Non-code

- [ ] The repo directory on disk (`~/Desktop/lone-star-management`)
- [ ] `CLAUDE.md` / `AGENTS.md` / `CONTEXT.md` / `TODO.md` headings
- [ ] `packages/site-bridge/CONNECTING.md` — the rule sheet new sites read
- [ ] The three live sites' footers/credits, if any name Lone Star
- [ ] The Supabase project name, the Vercel project names, the GitHub repo

---

## 5. After

- [ ] `npm run build` + `npx tsc --noEmit`
- [ ] Full `npm test` (the rename touches `next.config.ts`'s `transpilePackages`; a
      missed entry there fails at import time, not at type-check time)
- [ ] `npm run audit:regions` and `npm run audit:grants` — unaffected, but cheap
- [ ] Grep for leftovers: `grep -ri "lone.star\|lonestar" --include='*.ts' --include='*.tsx' --include='*.json' . | grep -v node_modules`
