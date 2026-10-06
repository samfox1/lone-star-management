# PayPal
One line: connecting it gives the artist's site a PayPal button that links to their public PayPal.Me page. This is a link only — we never touch payment info, credentials, or account numbers.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The PayPal.Me name alone (e.g. "the PayPal.Me name"), shown between its address in grey (`paypal.me/` [name]). Accepted: the name alone, or a pasted profile link from paypal.me or paypal.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters and numbers only, 1-20 characters (PayPal's own published rule — no dashes, underscores or spaces). Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9]{1,20}$/`

PayPal.Me links can carry an amount and currency after the name (`paypal.me/skeenmusic/25`, `paypal.me/skeenmusic/25AUD`) — this codebase never keeps that. Only the first path segment (the name) is read; a pasted link with an amount quietly saves as the bare name link, the amount dropped, so a manager can never accidentally connect a payment-request link instead of a profile link.

A `paypal.com/paypalme/<name>` link (the other real shape PayPal issues) is read down to its name and rebuilt on `paypal.me`. Any OTHER paypal.com path (a donate-button link, the sign-in page) reads as no name at all ("Enter the PayPal page name."): paypal.com is PayPal's whole site, and reading its first path segment would turn `paypal.com/donate` into `paypal.me/donate`, a stranger's page (fixed 2026-09-28). The bridge lists `paypal.com` as an alias, so the site and the wrong-platform check read both hosts as PayPal.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the PayPal page name."
- Doesn't match the rule: "That doesn't look like a PayPal page name."
- A link from a different known platform: "That's a Venmo link, not PayPal."
- A link from an unknown host: "That isn't a PayPal link."

## How it is stored
`links` row: label "PayPal", url = `https://paypal.me/<name>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `paypal` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://paypal.me/'`; `aliasHosts: ['paypal.com']`.

Mark: `social-icons.ts`, from simple-icons (CC0, `paypal`, brand colour `#002991`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/paypal/index.ts` — this service's own code: `social`: the handle spec, `fromPath` for paypal.com (only `/paypalme/<name>`).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the name, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `paypal.me/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the name into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored name afterwards (`KvField` + `saveHandle`), labelled "Page name".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('paypal')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Integration (research)
Docs read: [PayPal.Me FAQs: How It Works](https://www.paypal.com/us/cshelp/article/paypalme-frequently-asked-questions-help432) — quoted: link names are alphanumeric only, up to 20 characters, cannot be changed once created, and one per PayPal account. The `paypal.com/paypalme/<name>` alternate host form and the amount/currency suffix shape (`/<name>/<amount>[CCY]`) were both confirmed on that same page.

PayPal has APIs (Payouts, Checkout, Invoicing) but none of them expose a way to read a PayPal.Me name's public page or receipts — every PayPal API needs the artist's own merchant credentials and a full OAuth/API-key setup, which is a different, much heavier integration than a profile link.

**Verdict:** no sync possible from a plain PayPal.Me link. Any future PayPal integration would be a separate merchant-account connection (like Shopify), not an extension of this link.

## Tests

Specific to PayPal:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "PayPal — a PayPal.Me name from either shape, and never another paypal.com page" (the amount is dropped; a donate-button or sign-in link is refused).
- `tests/unit/site-editor/social-hosts.test.ts` — "the platforms’ own other domains": `paypal.com` reads as PayPal.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- PayPal.Me names can't be changed once created (per PayPal's own FAQ) — nothing here enforces or reflects that; the manager can freely edit the stored value on our side even though PayPal itself would refuse to let them change the real page.
