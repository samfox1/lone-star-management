# Launch checklist

Sam (2026-09-28): "Maybe we should start building a final steps todo when I am ready to
finalize and ship this project." The things to do once, at launch, gathered in one place.
Add to it whenever something is "for later, when we ship". Day-to-day work stays in TODO.md.

## 1. Put the dashboard online

- [ ] A Vercel project for the dashboard (today it runs only on localhost:3000) and its
      address, e.g. `app.digitaltapir.com` (Sam bought digitaltapir.com 2026-09-28 as the main URL). Set `NEXT_PUBLIC_APP_URL` to it.
- [ ] Every secret in Vercel → Settings → Environment Variables, marked **Sensitive**
      (Production only unless a preview needs it). `.env.local` stays on the Mac for dev.
- [ ] Supabase → Authentication → URL configuration: the new address as Site URL and in the
      redirect list.
- [ ] Remove the dev-only sign-in bypass variables from anything that isn't local
      (`.env.example`, "Dev-only auth bypass").

## 2. The "Connect with…" logins

- [ ] Add the real address's callback beside the localhost one (keep localhost for dev):
      YouTube `https://<address>/api/youtube/callback`, Eventbrite
      `https://<address>/api/eventbrite/callback`, Shopify `https://<address>/api/shopify/callback`
      (+ its app URL and webhooks, see the Shopify service README).
- [ ] Google: a public homepage, **privacy policy** and terms on digitaltapir.com, then
      Audience → Publish app → Google's review. Until then, Testing mode (≤100 test users).
- [ ] Eventbrite: approval if they require it for accounts outside ours.
- [ ] Shopify: switch to a public (unlisted is fine) app once a second artist has a store.

## 3. Secrets hygiene

- [ ] A master copy of every key in a password manager (not in notes, chat or email).
- [ ] Rotate any key that was ever pasted somewhere shared.
- [ ] `chmod 600 .env.local` on any machine that has one.

## 4. Name and email

- [ ] The Tapir rename (RENAME_CHECKLIST.md), incl. crawler user-agent strings that still say
      lone-star.
- [ ] Main URL is **digitaltapir.com** (Sam, 2026-09-28): point its DNS at the marketing site
      and the dashboard (`app.`), verify it in Resend, then move the enquiry sender off
      `noreply@tapirwebsites.com` (verified, working today; `mail_settings` is data, see
      RENAME_CHECKLIST.md §0). Keep tapirwebsites.com redirecting.
- [ ] Stage 3 (bridge/site) of enquiry forwarding.
- [ ] Enquiry audio of deleted enquiries (`enquiry_file_purges`) is drained only when a contact
      form is submitted (the contact Edge Function). Once the dashboard is online, add a nightly
      runner (Vercel Cron route with the service client, or pg_cron + pg_net calling a function)
      that drains the same queue, so files go on a quiet week too
      (`20261005120000_enquiry_retention.sql`).
- [ ] Enquiry status `sent` means Resend ACCEPTED the email, not that it was delivered. There is
      no bounce handling yet, so an enquiry sent to a mistyped recipient still counts as emailed
      and is deleted at 30 days, though nobody ever got it. Follow-up: a Resend bounce webhook
      that marks the enquiry `failed`, which moves it to the 90-day class and shows it in the inbox
      (`20261005120000_enquiry_retention.sql`, `src/lib/enquiries/retention.ts`).

## 5. Search and AI visibility (per artist site)

- [ ] Google Search Console + Bing Webmaster Tools for each artist domain (skeenmusic.com first).
- [ ] MusicBrainz page per artist (Connections → MusicBrainz → Create the page).

## SEO/GEO tests

- [ ] The run after each Publish lives in the publish request's `after()` (lib/seo-tests/after-publish.ts):
      a 10 s settle, up to ~90 s waiting for the site to show the publish, up to 150 s of retries if a run
      is already going, then the run's 90 s budget (~340 s worst case). On Vercel that must fit the
      publishing routes' `maxDuration`, or move it to a queue/background job. Killed mid-run, the run stays
      "running" until the next claim marks it failed after 5 minutes. "Test again" needs ~90 s too.
- [ ] Runs are WRITTEN with the service key (`SUPABASE_SERVICE_ROLE_KEY`, lib/supabase/admin) from the
      server: the dashboard host needs it set (Sensitive, server-only), or no run can be stored.
- [ ] The scheduled (weekly) run: nothing schedules one yet, and the Overview shows no weekly events
      until something does. Add a cron (Vercel Cron or Supabase `pg_cron` + an Edge Function) that runs
      `runSeoTests(service client, artistId, 'scheduled', { writer: service client, userId: null })` per
      custom-site artist; `seo_test_claim` already accepts `trigger = 'scheduled'` with no person.
- [ ] MusicBrainz's 1 request a second is kept PER PROCESS only (the gate in lib/seo-tests/musicbrainz.ts
      is module memory). Several server instances (Vercel functions, or a weekly run fanned out per
      artist) share one outbound IP but not that gate, so together they can exceed the limit and get
      503s (each lookup then ends "couldn't check", never a false "no page"). Before scheduled runs or
      real traffic: a shared limiter (a row + advisory lock in Postgres, or Upstash) or one queue that
      does every MusicBrainz lookup.

## 6. Before the switch

- [ ] Full test suite + `npm run audit:grants`, green.
- [ ] Bandsintown: live only after its terms are met (`BANDSINTOWN_TERMS_COMPLIANT`).
- [ ] PostHog cross-check deleted (decision on/after 2026-10-15, TODO.md).
