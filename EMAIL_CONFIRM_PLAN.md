# Email confirmation codes (plan, 2026-10-05)

Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to make sure the
email is legit" … "this should be required before deploying". A LAUNCH BLOCKER (TODO.md).

Mock approved 2026-10-05: `prototypes/email_confirm_20261005.html` (round 2), with these calls:

- After an address is added, **a window opens at once**: "Enter the 6-digit code", "Sent to
  <address>", six underline slots, a resend glyph with a 60 s countdown. It confirms on the 6th
  digit. No button. Closing it is fine.
- A waiting address shows **blue** (the pending colour) with a **key** glyph after it (Sam: "Lets
  do key"). Clicking it brings the window back (hover label "Enter code").
- **Ross and skeen@ get the confirm email once** when this goes live ("Lets try the confirmation
  email for Ross and Skeen"). They show blue + key until confirmed.
- **Legacy grace: 14 days.** Addresses already on a list when this ships keep receiving enquiries
  for 14 days while unconfirmed, then stop. (Recommended to Sam; he picked key without
  overriding it.)

## What it guards

An address Tapir SENDS enquiries to is used only once confirmed. The one choke point is
`resolve_enquiry_recipients` (every enquiry email's To: list comes from it): it returns only
addresses that are confirmed for that artist, or still inside their legacy grace. A missing
confirmation row means NOT confirmed (default deny).

Out of scope here: the public booking contact the site shows (site_content.booking_email / the
booking link). Nothing sends to it. Noted for later.

## The rules

| | |
|---|---|
| Code | 6 digits, 15 minutes, 5 wrong tries then it is dead (send a new one) |
| Wrong tries per day | at most 10 per address in any 24 h, across every code sent; then every code is refused (`'locked'`) until the oldest try is a day old. A resend does not reset it. The link still works |
| Link | the email's Confirm button, 7 days |
| Resend | not within 60 s of the last; per address at most 5 an hour and 10 a day; at most 20 per artist per hour; at most 200 per hour across the whole platform (one global lock, so sends arriving at once cannot slip past) |
| One per address | confirmation is per (artist, lower(email)): skeen@ on three lists confirms once |
| Removal | an address off every list is forgotten: confirmation, grace, code and link cleared (20261006130000). Its send and wrong-try times STAY (20261006160000), so removing and re-adding it resets no limit |
| New send | replaces the code AND the link (only the latest email works) |
| Only listed addresses | a code is only ever sent to an address on one of the artist's lists |
| Stored | only SHA-256 hashes of the code and the link token, never the plaintext |
| Neutral | the email never says whether the address is used anywhere else |

## The pieces (contracts)

### 1. SQL: `supabase/migrations/20261006120000_email_confirmations.sql`

Table `public.artist_email_confirmations`, primary key `(artist_id, email)`:

- `artist_id uuid not null references artists(id) on delete cascade`
- `email text not null check (email = lower(email))`
- `confirmed_at timestamptz` · `grace_until timestamptz`
- `code_hash text` · `code_expires_at timestamptz` · `code_attempts int not null default 0`
- `token_hash text unique` · `token_expires_at timestamptz`
- `sent_at timestamptz[] not null default '{}'` (send times inside the last 24 h, for the caps)
- `wrong_at timestamptz[] not null default '{}'` (wrong-code times inside the last 24 h: the daily
  budget a resend does not reset)
- `created_at timestamptz not null default now()`

RLS ON with NO policies: nobody reads it directly. Everything goes through these functions
(hashing in SQL with `extensions.digest(..., 'sha256')`, randomness with
`extensions.gen_random_bytes`):

| function | who (grants per AGENTS.md) | does |
|---|---|---|
| `email_confirmation_status(p_artist_id)` → `(email, confirmed bool, waiting bool)` | manager-facing (authenticated, `is_admin() or is_manager_of`) | for every address on the artist's lists: confirmed, or waiting. Never returns hashes |
| `begin_email_confirmation(p_user_id, p_artist_id, p_email)` → `(status, code, token, artist_name, kinds text[], site_host)` | SERVICE-ONLY | checks `p_user_id` manages the artist (artist_managers) or is admin; the address is on one of the artist's lists; already confirmed → `status 'confirmed'`, nothing generated; caps → `'too_many'` (checked first) / `'too_soon'`; else generates a 6-digit code and a 32-byte url-safe token, stores their hashes + expiries, resets attempts, appends to `sent_at`, returns `'sent'` with the PLAINTEXT code and token (the only time they exist) |
| `confirm_email_code(p_artist_id, p_email, p_code)` → `status` | manager-facing | row locked; 10 wrong in the last 24 h → `'locked'`; no live code → `'expired'`; attempts ≥ 5 → `'locked'`; wrong → attempts+1 and logged in `wrong_at`, `'wrong'` (or `'locked'` when that spends either budget); right → `confirmed_at = now()`, code and token cleared, `'confirmed'` |
| `confirm_email_token(p_token)` → `(status, email, artist_name, kinds text[])` | SERVICE-ONLY | by token hash; expired/unknown → `'invalid'`; else confirms as above |

`resolve_enquiry_recipients` (same signature) filters to confirmed-or-in-grace.

Data step in the same file: one row per distinct (artist, lower(email)) already on any list, with
`grace_until = now() + 14 days`, `confirmed_at` null.

Tests (STRICT tier, `tests/integration/enquiries/email-confirmations.test.ts`): door grants
(`expectExecuteDenied` for anon on all four, for authenticated on the two service-only ones);
a non-manager cannot read status or confirm (planted witness); routing excludes an unconfirmed
address and includes it after confirm; grace includes then (with grace in the past) excludes;
wrong-code count and lock; expiry; resend caps; token single use; one confirm covers every
list; no plaintext stored (hash ≠ code). Throwaway artists only, teardown scoped.

### 2. Edge Function: `supabase/functions/email-confirm/`

`POST` with the manager's JWT (`Authorization: Bearer`), body `{ artistId, email }`.
`verify_jwt = true` (called server-to-server from the dashboard, no browser preflight).

1. `auth.getUser(jwt)` with the service client → user id (401 if none).
2. `begin_email_confirmation(user, artist, email)` with the service client.
3. `'sent'` → send via Resend from the house sender (mail_settings, as contact does).
   Subject: `Confirm <Artist>'s enquiries`. Text + simple HTML body:
   "<Artist>'s team wants to send <booking and contact> enquiries from <site host> to this
   address." · the code as `482 913` · a Confirm link `${APP_URL}/confirm-email/<token>` (only
   when `APP_URL` is set) · "Not you? Ignore this email and nothing is sent."
4. Returns `{ status }` only. NEVER the code or token. Resend failure → `{ status: 'send_failed' }`
   (the hashes stay; resend allowed after 60 s).

Pure parts (`build.ts`: subject, text, html, kinds-to-words) unit-tested under
`tests/unit/enquiries/`. `DRY_RUN` like contact.

### 3. Dashboard: Settings › Email (`enquiries/kind-rows.tsx` + actions)

- The loader adds `email_confirmation_status`; each address renders ink (confirmed) or accent
  blue + the `key` glyph (waiting). New icon `key` in `src/components/ui/icons.tsx`.
- Adding an address: save the list (as today), then `sendEmailCodeAction` (server action that
  calls the Edge Function with the session's access token), then the window opens.
- The window (`_ui`-free, enquiries-only for now): CardModal untitled, first line level with ×:
  "Enter the 6-digit code" / "Sent to <address>"; six underline slots (paste fills them, Backspace
  moves back); the 6th digit calls `confirmEmailCodeAction`; `'wrong'` shakes and clears,
  `'locked'`/`'expired'` say so in one line and enable resend; resend glyph bottom-left with a
  60 s countdown.
- Clicking a blue address sends its code and opens the window, unless a code it can still type is
  out: then it opens on that code (Sam, 2026-10-05: send it "and then the modal opens after").
- Editing an address REPLACES it in place (Sam, 2026-10-05: "If a email has been deleted (hit the
  x on it to remove it), it should stop recieving emails"): the list is saved with the new address
  where the old one was, the old one stops receiving at once, and the new one waits (blue + key),
  its code is sent and the window opens. Nothing keeps the old one until the new one confirms.
- Light tests: one main path (add → window → 6 digits → confirmed shows ink).

### 4. The link page: `src/app/confirm-email/[token]/page.tsx`

Public. GET shows "Confirm <email> for <Artist>'s <kinds> enquiries?" and a Confirm button that
POSTs (a server action with the service client → `confirm_email_token`), so link scanners that
pre-open URLs do not confirm. Then: the check, "Confirmed", "<email> gets <Artist>'s booking
enquiries." `'invalid'` → "This link has expired. Ask for a new code."

NOTE: the link only works where the dashboard is ONLINE (`APP_URL`). Until the dashboard is
deployed with this page, confirming is by code.

## Going live (each needs Sam's yes)

1. Full suite green.
2. Push the migration (`npm run db:push`).
3. Deploy `email-confirm` RIGHT AFTER (from the push on, new addresses get nothing until
   confirmed, and only this function sends a code). Smoke-test with `EMAIL_CONFIRM_DRY_RUN`
   first if wanted (a dry run still uses a send slot).
4. Same change: set `EMAIL_CONFIRMATIONS_PUSHED = true` (`tests/helpers/email-confirmations.ts`),
   REMOVE the PGRST202 fallback in `confirmStateFrom` (`src/lib/enquiries/confirm.ts`; it fails
   open), run `tests/integration/enquiries/` and `npm run audit:grants`.
5. Send Ross and skeen@ their one email (the resend glyph in each one's window, or a script).
6. The grace runs 14 days. Check before it ends who is still blue (an unconfirmed address then
   stops getting enquiries; a kind with nobody confirmed is stored unroutable).
7. `EMAIL_CONFIRM_APP_URL` stays unset until the dashboard serving /confirm-email is online;
   until then the email carries the code only.

Later (from the 2026-10-05 review, LOW): the link token is in the URL path, so it shows in
hosting request logs for its 7 days (move it to a `#fragment`); no warning before grace ends.
