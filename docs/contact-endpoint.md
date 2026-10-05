# The contact enquiry endpoint — setup and smoke test

`POST {SUPABASE_URL}/functions/v1/contact` takes a contact-form submission from an
artist site, stores it in `enquiries`, and emails it to the artist's booking address via
Resend.

Design rationale is in `docs/adr/0010-edge-functions-as-public-doors.md` and the headers
of the two migrations (`20260722120000`, `20260722130000`). This file is the runbook.

---

## What is already done

- Both migrations are applied.
- `supabase/functions/contact/` is written, and `[functions.contact] verify_jwt = true`
  is in `config.toml`.
- Tests are green: `tests/unit/enquiries/contact-validate.test.ts` (pure),
  `tests/integration/enquiries/enquiry-door.test.ts` (the RPC, against the real DB),
  `tests/integration/enquiries/enquiries.isolation.test.ts` (the boundary).

## What is still blocked on a human

**Nothing sends until steps 1–3 are done.** They are the DNS-and-secrets part.

### 1. Verify a sending domain with Resend

Resend will only send from a domain verified by DNS (SPF + DKIM). We **cannot** send
`from:` the artist's booking address — e.g. `ross.guignon@everesttm.com` — unless Everest
control that DNS and add our records. Assume we can't, and don't try: a spoofed `From`
fails DMARC and lands in spam or is rejected outright.

So pick a domain **Lone Star controls** and verify it. That single domain serves every
artist for now; the schema already carries per-artist sending columns
(`artist_mail_settings.sending_domain`, `.resend_domain_id`, `.domain_verified_at`) so
moving an artist onto their own verified domain later is a data change, not a rewrite.

The visitor's address goes in `reply_to`, which is what makes this work in practice — the
manager hits reply and it goes straight to the enquirer.

### 2. Set the Edge Function secrets

```sh
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
supabase secrets set CONTACT_IP_SALT="$(openssl rand -hex 32)"
supabase secrets set CONTACT_ALLOWED_ORIGINS=https://<skeen-site-origin>
supabase secrets set CONTACT_DRY_RUN=true     # flip to false after the smoke test
npm run fn:secrets                            # confirm
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. Do not set
them. `RESEND_API_KEY` never goes in `.env.local` or `.env.example` — one `NEXT_PUBLIC_`
typo in those files ships it to every visitor's browser.

### 3. Seed the `mail_settings` singleton

One row, admin-only. It is the SENDER only: the verified domain and the local part every
enquiry goes out from. Until it exists, every enquiry is stored `unroutable` (in the
inbox, not emailed).

```sql
insert into public.mail_settings (sending_domain, from_local_part)
values ('tapirwebsites.com', 'noreply');
```

`default_to_email` is **unused since 2026-09-28** and stays null. It used to be a global
last-resort inbox (Sam's); Sam: "my email shouldn't be involved here". See below.

**Tests never write this row.** It is live config and the suites run against the hosted
project. A test that needs "no sender" sets `artist_mail_settings.use_house_mail = false`
on its own throwaway artist; `tests/unit/enquiries/no-live-mail-writes.test.ts` fails if
any test file writes `mail_settings`.

### 4. Deploy

```sh
npm run fn:deploy
```

---

## Smoke test

Run this with `CONTACT_DRY_RUN=true` so nothing reaches a real inbox. `$ANON` is the
public anon key; `$URL` is the project URL.

```sh
# 1. Preflight must return 204 with the CORS headers, including `apikey`.
curl -i -X OPTIONS "$URL/functions/v1/contact" \
  -H "Origin: https://<allowed-origin>" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: apikey, content-type"

# 2. A real submission → 200 {"ok":true}
curl -sS -X POST "$URL/functions/v1/contact" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"slug":"lone-pine","purpose":"booking","name":"Jane Promoter",
       "email":"jane@venue.example","message":"Test enquiry.","website":""}'

# 3. Honeypot → 200 {"ok":true} AND no row in `enquiries` (it is silently dropped;
#    telling the bot it was caught only teaches it to leave the field alone).
curl -sS -X POST "$URL/functions/v1/contact" ... -d '{...,"website":"http://spam"}'

# 4. Bad address → 400 {"ok":false,"error":"invalid_email"}
# 5. 5001-char message → 400 {"ok":false,"error":"message_too_long"}
# 6. Run #2 six times → the sixth returns 429 {"ok":false,"error":"rate_limited"}
#    with Retry-After: 3600.
# 7. No apikey header at all → 401 from the platform (verify_jwt).
```

Then check the dashboard at `/artists/<id>/enquiries` — every accepted submission should
be listed. A dry run leaves them `queued`, never `sent`: nothing was emailed, and since
retention (2026-10-05) `sent` means "deleted at 30 days" (`deliveryRecord` in
`supabase/functions/contact/validate.ts`).

**Before flipping `CONTACT_DRY_RUN=false`**, point one send at Resend's sink address
`delivered@resend.dev` for a real API round trip with no real inbox involved. Then flip
it and send one genuine enquiry end to end.

Clean up afterwards (service role):

```sql
delete from public.enquiries where email = 'jane@venue.example';
delete from public.contact_attempts where created_at > now() - interval '1 hour';
```

---

## Where the recipient comes from

Resolved server-side, **never** from the request body — accepting it from the client
would make this an open relay and get the sending domain blacklisted.

Since 2026-10-02 (`20261002210000`) each kind goes **only to its own recipient list**
(`resolve_enquiry_recipients`; next section), first-added as primary. The old fallback chain
(`artist_mail_settings.booking_email` → booking link → `site_content.booking_email`) routes
nothing; `resolve_booking_recipient` was dropped. A kind with no addresses: the enquiry is
stored `unroutable`, shows in the inbox, and nothing is sent. No global inbox either
(`20260928141000`).

**These read working rows, not published revisions** — correcting a dead address
takes effect on enquiries immediately, without publishing every other in-progress edit
alongside it. `enquiries.to_email` freezes what was resolved for each row, so "where did
that one actually go?" stays answerable after the address changes.

---

## Abuse controls

- **Per IP**: 5/hour, 20/day → 429. Counted over `contact_attempts`, which logs *every*
  attempt including honeypot hits and rejections, so probing the endpoint is not free.
  The IP is SHA-256'd with `CONTACT_IP_SALT` in Deno, so the raw IP never reaches the DB.
- **Per artist**: 30/hour, so one inbox can't be flooded from a botnet of distinct IPs.
- **Honeypot**: a non-empty `website` field → 200 and a silent drop.
- **Validation**: required fields, email syntax, message ≤ 5000 chars.
- Rotating `CONTACT_IP_SALT` resets everyone's rate-limit window — a blunt way to clear a
  jam.

---

## What skeen needs to do

Add `sendContact()` to `lib/backend.ts` alongside `get_public_site` / `record_event` /
`subscribe`, and swap `ContactModal`'s `mailto:` handler for it, with pending / sent /
failed states. Keep the `mailto:` as the failure fallback so an enquiry is never lost.

```
POST {SUPABASE_URL}/functions/v1/contact
Headers: apikey, Authorization: Bearer <anon key>, Content-Type: application/json
Body:    { slug, purpose: "booking"|"demo"|"other", name, email, message, website }

200 → { "ok": true }
400 → { "ok": false, "error": "invalid_email" | "missing_field" | "message_too_long" }
429 → { "ok": false, "error": "rate_limited" }
5xx → { "ok": false, "error": "send_failed" }
```

`website` is the honeypot: render it hidden, leave it empty for real users.

Skeen should also declare `booking` as a link region in the manifest it posts on `ready`,
so the manager can set the public booking contact from the editor (it routes no enquiries).
`mapConfig`'s existing `role = 'booking'` resolution already matches.

An unrecognized `purpose` is coerced to `"other"` rather than rejected, so skeen can ship
a new purpose value before this side knows about it.

---

## Kinds and recipient lists (2026-09-21/22)

`purpose` is no longer one of three values. Each artist has their own **kinds**
(`enquiry_kinds`: `booking`, `demo`, `other` seeded on every artist, plus any the manager
adds), and each kind has a **recipient list** (`enquiry_recipients`, at most 10) that is
everyone it goes to, first person as primary. One message goes out with all of them in `to`. A `purpose` that matches none of the artist's kinds is filed under `other`.

Where the code lives:

- `supabase/functions/contact/` — the public door (cannot move; it cannot import `src/`).
- `src/lib/enquiries/` — pure logic: `kinds.ts` (slug derivation, labels, list checks),
  `inbox.ts`, `inbox-server.ts`, `attachments.ts`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/` — the tool: page, kind rows + modal,
  inbox table, and every server action (`set_enquiry_recipients` is the atomic list write).
- `tests/{unit,components,integration}/enquiries/`.

Migrations: `20260921120000_enquiry_recipients.sql` (the model), `20260922120000_enquiry_hardening.sql`
(atomic list write, rate-limit locks restored, `log_contact_attempt` fixed, unknown purpose
→ `other`, slug bound), `20260928140000_enquiry_delete.sql` (a manager can delete an
enquiry; the action removes its audio too), `20260928141000_enquiry_house_sender_only.sql`
(no global inbox; `mail_settings` is the sender only; `use_house_mail` per artist).
