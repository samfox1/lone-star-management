# 0010 — An Edge Function may be a public door, when Postgres provably cannot be

Status: Accepted (2026-07-21)

## Context

ADR 0001 fixed one shape for every unauthenticated entry point into this system: a
`SECURITY DEFINER` Postgres function that resolves the tenant from the public slug,
returns published, public-safe data only, and is `revoke all` + `grant execute to anon`.
Seven doors follow it — `get_public_site`, `get_release`, `get_public_releases`,
`audio_path_for_play`, `record_event`, `subscribe`, `submit_application`.

That ADR's Consequences section also predicted its own failure mode:

> new features that touch the public site add anon doors; each must follow the
> resolve-from-slug + published-only pattern, **or the invariant erodes**.

Sending contact-form enquiries is the first feature that cannot follow it. The artist
sites (skeen today) need to POST an enquiry and have us email it to the artist's booking
address. Two hard requirements fall outside what a Postgres function can do:

1. **Per-IP rate limiting.** A public unauthenticated send endpoint gets found and
   abused, and the only durable key for abuse is the client IP. A DB function cannot see
   it — the caveat already written into
   `20260706150000_subscribe_rate_limit.sql`, which settled for a coarse per-artist cap
   and explicitly deferred per-IP to "the edge". Passing the IP in as a parameter to an
   anon-granted function is not a rate limit at all: the attacker picks the parameter.
2. **An outbound HTTP call.** Handing the enquiry to Resend is a network request.

There is also a disclosure constraint that rules out the obvious compromise. The
recipient MUST be resolved server-side — if the client supplied it, anyone could POST to
the endpoint and relay mail to arbitrary addresses from our verified domain, which is an
open relay and gets the sending domain blacklisted. But an anon-granted RPC that resolves
the recipient must *return* it to its caller, which makes the door an
address-harvesting endpoint for every artist we host.

So the anon-granted-RPC shape fails on all three counts simultaneously. The question is
not whether to bend it but where the door goes instead.

## Decision

- **The public door for enquiries is a Supabase Edge Function**, `POST
  /functions/v1/contact` (`supabase/functions/contact/`). It is the only
  anon-reachable surface for this feature.
- **The Postgres function behind it, `submit_enquiry`, is NOT granted to `anon`.** It is
  granted to `service_role` only, and the Edge Function calls it with the
  platform-injected service key. So does `resolve_booking_recipient`,
  `log_contact_attempt`, and `mark_enquiry_sent`.
- **`submit_enquiry` is `security invoker`, not `security definer`** — the deliberate
  inverse of every other door. Its caller already bypasses RLS, so DEFINER buys nothing,
  and INVOKER makes it fail closed if the grant is ever widened by mistake: an anon
  caller would reach `enquiries`, find no insert policy, and be denied.
- **`submit_enquiry` returns a status; it must never `raise`.** It writes the rejected
  attempt to `contact_attempts` and then reports the rejection. A `raise` would roll back
  its own ledger row, so the rate limiter would forget every rejection it ever made.
  This is the one place where copying the house style (`subscribe`, `submit_application`
  both raise) produces a security bug.
- **ADR 0001's invariant is restated, not weakened.** The rule was never "the door is a
  Postgres function"; it was *resolve the tenant from the slug server-side, expose only
  what the public may see, and never trust the client for either*. The Edge Function
  keeps all three: it takes a slug, resolves the artist and the recipient server-side,
  and returns `{ok:true}` and nothing else.
- **A new public door may live at the edge only when Postgres provably cannot host it** —
  it needs the client IP, an outbound request, or a secret that must not reach the
  database. Convenience is not a reason. When it does live at the edge, the RPC beneath
  it stays service_role-only.

## Consequences

- **The public surface is now two kinds of thing**, so "list the anon doors" is no
  longer one grep for `grant execute ... to anon`. `supabase/functions/*` has to be read
  too. `tests/enquiries.isolation.test.ts` asserts the anon path is closed from the
  Postgres side, which is the half that would silently reopen.
- **Secrets move.** `RESEND_API_KEY` and `CONTACT_IP_SALT` live in Edge Function secrets
  (`supabase secrets set`), not `.env.local` and never `NEXT_PUBLIC_*`. See
  `supabase/functions/.env.example`. This is the first secret in the project that the
  Next app does not hold.
- **CORS becomes ours to get right.** PostgREST handled it for the RPC doors. The
  function ships an explicit origin allowlist (`CONTACT_ALLOWED_ORIGINS`) rather than
  `*`, because a wildcard would let any site on the internet deliver its own form
  submissions through our verified sending domain into our artists' inboxes.
- **Deploys are no longer just `db:push`.** A migration and a function deploy can now
  drift apart. `npm run fn:deploy` is the second step, and a schema change to
  `submit_enquiry`'s return shape breaks a deployed function until it is rerun.
- **The edge is thin on purpose.** `npm test` cannot execute Deno, so everything the
  function decides lives either in `contact/validate.ts` (pure, no imports, covered by
  `tests/contact-validate.test.ts`) or in the RPC (covered by
  `tests/enquiry-door.test.ts`). Logic added to `index.ts` is logic nobody can test —
  that is the standing cost of this ADR, and the reason to keep new doors in Postgres
  whenever Postgres can still host them.
- **Recipient resolution reads WORKING rows, not published revisions**, breaking with
  ADR 0002's published-only default for public reads. Justified because the recipient is
  never observable by the visitor, so there is no published state to be consistent with —
  while the alternative couples "fix a dead booking address" to "publish every other
  in-progress edit". `enquiries.to_email` freezes what was resolved per row so the
  history stays answerable.
