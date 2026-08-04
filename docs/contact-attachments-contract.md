# `/contact` response contract — demo links and audio attachments

For the skeen side. **Revised 2026-08-04 after skeen found a flaw in the first draft.**
Implemented on the lone-star side; not deployed yet (the function still needs its secrets
and a `supabase functions deploy`).

## What changed since the first draft, and why

The first version rejected the whole enquiry with `unsupported_audio_type` if any one file
was not audio. Skeen pointed out that a stray `.zip` picked alongside a demo would then
lose the entire message — and that this contradicts the endpoint's own design, which
stores the enquiry BEFORE attempting to send precisely so a message is never lost to a
downstream problem. Same principle, applied inconsistently. They were right.

**A bad demo link or a non-audio file no longer fails anything.** It is dropped, named in
a new `skipped` array, and the enquiry goes through. Files past the cap of three are
dropped the same way rather than rejected.

This is ADDITIVE for you. The 400 codes still exist and your handling of them is still
correct — they simply stop firing for this case. The only new thing is `skipped`, which
you can surface or ignore.

Your client-side fix (dropping non-audio at the picker, visibly) is still the right
behaviour and should stay: it tells the visitor at the moment they choose, which is far
better than telling them after they press send. The server change is defence in depth, for
the case where a picker guard regresses or someone posts directly.

## What changes, in one line

Success stops being `{ ok: true }` and becomes
`{ ok: true, uploads: [...], skipped: [...] }` — one-shot upload tickets, plus anything we
declined to carry. The request gains two optional fields. No error shape changes.

---

## Request

Two new optional fields. Everything else is as it is today.

```jsonc
POST /functions/v1/contact
{
  "slug": "skeen",
  "purpose": "demo",              // "booking" | "demo" | "other"
  "name": "...",
  "email": "...",
  "message": "...",
  "website": "",                  // honeypot, unchanged

  "demo_url": "https://...",      // OPTIONAL. https ONLY. ≤2048 chars.
  "attachments": [                // OPTIONAL. At most 3.
    { "filename": "demo.mp3", "mime_type": "audio/mpeg", "bytes": 4210233 }
  ]
}
```

`demo_url` — validated server-side, `https:` scheme only. `http:`, `javascript:`, `data:`
and anything else are DROPPED and reported in `skipped`; they never fail the enquiry. This
is attacker-controlled text that a manager will click, so it is also rendered through
`safeHref` with `rel="noopener noreferrer"` in the dashboard — two guards, because a stored
row can outlive the validator that let it in. Send it only on demos; it is ignored
elsewhere.

`attachments` — **metadata only, no bytes.** You are describing what you intend to upload
so the server can decide whether to let you. `bytes` is what you claim and is never
enforced — the bucket's own size cap is the real limit. It is also no longer shown to the
manager as fact: the dashboard reads the REAL size from storage and displays nothing when
that is unavailable, so a declared 1 byte against a 25MB upload misleads nobody. Send it
anyway; it costs nothing and may become useful.

**Purpose does not gate attachments.** They are accepted on `booking` and `other` as well
as `demo`. Refusing them elsewhere would be a surprise with no security benefit, and audio
is audio. `demo_url` is likewise stored whatever the purpose.

**Multiple problems report together.** A bad link plus a fourth file yields two entries in
`skipped`, not a single winning error — there is no precedence to reason about because
nothing rejects.

Allowed `mime_type`: `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/x-wav`,
`audio/aac`, `audio/ogg`, `audio/flac`. Anything else is dropped into `skipped` before any
ticket is minted — no ticket is ever issued for a file the bucket would refuse, which
would be a wasted write capability handed to a stranger.

---

## Response

### 200 — accepted

```jsonc
{
  "ok": true,
  "skipped": [
    { "item": "notes.zip", "reason": "unsupported_audio_type" }
  ],
  "uploads": [
    {
      "filename": "demo.mp3",                                  // echoed back, so you can match tickets to files
      "bucket": "enquiry-attachments",
      "path": "<artist_id>/<enquiry_id>/<uuid>-demo.mp3",
      "token": "...",                                          // for supabase-js uploadToSignedUrl
      "signed_url": "https://<project>.supabase.co/storage/v1/object/upload/sign/..."
    }
  ]
}
```

`uploads` is **`[]` when no attachments were requested**, not absent. Treat an empty array
and a missing key the same way anyway — it costs you nothing and survives me changing my
mind.

**`uploads` can be SHORTER than `attachments`.** If signing a ticket fails, that file gets
an entry in `skipped` with reason `upload_unavailable` instead of a ticket. So match on
`filename`, never on index — index matching would pair the wrong ticket to the wrong file
the moment one is missing. (The first draft promised order matching; it was not true, and
your client was already right to ignore it.)

The `filename` echoed back is the RAW one you sent, while `path` carries the sanitised
version. That is deliberate so your pairing survives spaces and punctuation.

### The upload call

With supabase-js:

```ts
await supabase.storage
  .from(u.bucket)
  .uploadToSignedUrl(u.path, u.token, file)
```

Or a plain `PUT` to `signed_url` with the file as the body.

**Failures here are yours to handle and are not fatal to the enquiry.** The enquiry is
already stored by the time you hold a ticket — that is the point of the ordering. If an
upload fails, the manager still receives the message; they just don't get that file. Do
not retry the whole `/contact` call, and do not block the "sent" confirmation on uploads
completing.

### `skipped` — what we refused to carry

Each entry is `{ item, reason }`. `item` is the filename, or the literal string
`"demo link"`. `reason` is one of `invalid_demo_url`, `unsupported_audio_type`,
`too_many_attachments`.

Worth surfacing rather than swallowing: a visitor who deliberately attached something
expects it to arrive, so saying nothing reads as acceptance. Something like "sent — we
couldn't include notes.zip (audio only)".

### Errors — unchanged

| Status | Body | When |
| --- | --- | --- |
| 400 | `{ ok: false, error: "invalid_email" \| "missing_field" \| "message_too_long" }` | unchanged |
| 429 | `{ ok: false, error: "rate_limited" }` | unchanged |
| 5xx | `{ ok: false, error: "send_failed" }` | unchanged |

The three attachment codes from the first draft (`invalid_demo_url`,
`too_many_attachments`, `unsupported_audio_type`) are no longer returned as errors. They
survive as `reason` values inside `skipped`. Keeping your 400 handling costs nothing.

**No tickets are ever issued except with a 200.** In particular:

- The honeypot path returns `200 { ok: true, uploads: [], skipped: [] }` — byte-identical
  to a genuine submission with no files. A bot gets silence and no write capability. Do not
  treat an empty `uploads` as an error.
- A rate-limited request gets nothing. Minting tickets is itself counted as an attempt in
  `contact_attempts`, so attachments cannot be used to sidestep the per-IP limits.
- A failed send **now returns 200 with tickets**, not a 500. Your finding: the enquiry is
  already stored, so telling the visitor it failed makes them send again (two rows in the
  inbox) or give up believing nothing arrived — and it contradicts the reason storing
  happens first. A Resend outage is an ops problem, recorded where someone can act on it
  (`status='failed'` with `send_error`, plus the ledger). Fixed.

---

## Your two questions, answered

**Does `signed_url` accept a plain PUT with the file as the body?** Yes — verified against
the real bucket, not from memory. Minted a ticket exactly as the function does, then:

```
PUT <signed_url>
Content-Type: audio/mpeg
<file bytes>
→ HTTP 200 {"Key":"enquiry-attachments/<artist>/<enquiry>/<uuid>-name.mp3"}
```

and the object was there afterwards. Your choice to avoid pulling in supabase-js for one
call is fine. Do send `Content-Type` — the bucket enforces its allowed types against what
you declare.

**Should the honeypot's response differ from a genuine submission with no files?** No, and
your reading is right. They are identical on purpose: `{ ok: true, uploads: [], skipped: [] }`.
Any difference — a flag, a different shape, even a different key order — is a signal that
tells whoever wrote the bot which field caught them, and the next version of that bot just
leaves it alone. The silence is the feature.

## Two things I'd rather you heard from me than discovered

### 1. The ticket lives longer than "short-lived" implies

Supabase's signed upload tokens are valid for **two hours** and the TTL is not
configurable. The brief asked for short-lived, and two hours is what the platform gives.

What actually bounds the risk is not the clock: the path is an unguessable UUID inside a
folder scoped to one enquiry, the bucket is private with no public read, and it accepts
only audio MIME types under its own size cap.

**And the ticket is effectively single-use** — you asked, and I tested it rather than
assuming. A second PUT to the same path returns `409 Duplicate` (`KeyAlreadyExists`), so a
leaked ticket cannot replace audio the manager is about to listen to. It can only write if
the first upload never happened.

### 2. This relaxes a rule the endpoint currently states explicitly

`index.ts` says today:

> `{ok:true}` AND NOTHING ELSE. Never echo `to_email`, `from`, `enquiry_id`, or
> `recipient_source`.

A ticket embeds `artist_id` and `enquiry_id` in its path. There is no way to hand you a
scoped upload location without telling you the scope, so that rule has to give.

I'm satisfied it's safe, and here is the reasoning rather than an assurance:

- `artist_id` is **already public** — `get_public_site` returns it to anonymous visitors.
- `enquiry_id` grants nothing on its own. `enquiries` is manager-only under RLS, and there
  is no endpoint keyed on that id.
- The recipient fields — `to_email`, `recipient_source`, `from` — **still never appear**.
  Those are what the rule was protecting, and they are untouched.

I'll narrow the comment in `index.ts` to name the recipient fields specifically, so the
next person reading it doesn't think the ticket is a violation someone missed.

---

## Retention: files expire, messages don't

Attachment **objects are deleted after 90 days; the row is kept as a tombstone** (path
nulled, `expired_at` stamped). The enquiry itself is kept too — the message is small and it
is the manager's record of who got in touch.

You caught that the first version deleted the row as well, which made "attachment expired"
impossible to render: the attachment did not expire, it silently vanished, and a manager
could not tell that from an enquiry which never had audio. Fixed — the row survives with
its filename and type so the dashboard can say what is gone.

That also makes two states genuinely distinct, which the first version wrongly collapsed:

- **expired** — the file was here and the 90 days ran out
- **upload didn't complete** — a ticket was issued and the bytes never arrived

They lead to different next moves (only one is worth chasing a sender about), so the
dashboard says which. An abandoned upload is still not an error state you need to clean up.

Worth saying in your UI copy near the upload control: a visitor sending a demo should know
the file is not archived forever.
