# Service Model Plan

_Drafted 2026-08-21. This is a BUSINESS plan, not a technical one. The other
`*_PLAN.md` files at this root describe what the software does. This one describes
what the company sells and in what order._

## The reframe

Lone Star is not a website product with services bolted on. It is the artist's
**brand system of record**, with a human service layer that fills it.

The website is one renderer of that system. A tour poster is another. A Spotify
cover is another. Same fonts, same logo, same colours, same photos, same words,
rendered onto a different surface.

This reframe is the whole plan. Everything below follows from it.

### The rule that protects it

> Every human deliverable lands INSIDE Lone Star as a reusable asset. Never as a
> file emailed over.

The bio writer writes into the bio field. The designer uploads into the brand
library. A logo delivered as a Dropbox link is a job done once. A logo delivered
into the system is a logo that renders a poster next March without anyone being
paid again.

Break this rule and the company becomes a low-margin agency with a CMS attached.

## The two models considered

**A. All in one.** One bundled service. Every client gets the full treatment:
bio, identity, graphics, site. Lone Star produces everything.

**B. Product plus add-ons.** The Lone Star subscription is the base. Bio, branding
design, and graphic design are requested as add-ons, individually or as a package.

### Decision

**B long term. A-flavoured in the short term.**

Reasons for B:

1. **A caps growth at one person's hours.** Roughly 10 to 15 artists before the
   founder is the bottleneck, and every new client is a production commitment
   before it is revenue.
2. **Artists arrive in different states.** Some have a logo they love. Bundling
   forces them to buy a new one and forces us to redo work that was fine. The
   intake-dependent scope we already describe ("if they have a brand, we use those
   assets") IS the add-on model.
3. **The software is the part that compounds.** Services are the wedge and the
   retention. Software is the margin.

Why A short term: with no portfolio, nobody can picture what "branding add-on"
means. The first cohort gets all of it, or at least a worked example of each,
specifically so there is something to point at.

### The failure mode to design against

Pure a-la-carte becomes Fiverr with a CMS: random quality, no coherence, and
nobody buys because nobody knows what they need.

**The fix: the product tells them what they need.** See "Gap detection" below.

## Non-negotiables

1. **We never own the artist's IP.** Logo, photos, words, all owned by the artist.
   Lone Star takes a licence to use, display, and reproduce them across the
   surfaces it renders. Artists and their lawyers will walk otherwise, and
   management companies definitely will. Our moat is the system that holds the
   assets, not ownership of them.
2. **Contributors are credited and their rights tracked.** Who shot the photo,
   what licence, what credit line. Cheap to store, expensive to get wrong.
3. **Nothing is sold that does not feed the library.** If a service produces no
   durable asset, it is somebody else's business.

## What is in scope, and what is not

**In scope: how the artist looks and reads, everywhere.**

**Out of scope:** mixing, mastering, distribution, PR campaigns, tour booking.
Different businesses, different failure modes, and none of them feed the library.

## Accounts, roles, and access

_Decided 2026-08-21. This answers the "who is the customer" question below: it is
both, on one account, with different access._

### The customer

The account belongs to the **artist**, whether the artist pays for it themselves or a
manager or management team pays on their behalf. A manager-paid account still
requires the artist's active engagement. The artist is never a passive subject of
their own brand system.

### Roles

Access is **per artist**, not global. One person can be a manager on five artists and
the artist on none.

| Role | Who | Holds |
| --- | --- | --- |
| `owner` | whoever pays | billing, invites, removals, deleting the account |
| `artist` | the artist | voice and likeness: bio, photos, what appears on the site |
| `manager` | manager or management team | business: booking, tour, publishing, integrations |
| `contributor` | writer, designer, photographer | one scoped job, time-boxed |
| `admin` | Lone Star staff | everything (already exists as a global role) |

`owner` is a flag layered on `artist` or `manager`, not a separate person. Both
patterns are normal: a self-funding artist is `artist` plus `owner`; a signed artist
is `artist`, and their manager is `manager` plus `owner`.

### How this maps onto what exists

The schema already has the join. `artist_managers(user_id, artist_id)` is a per-artist
membership table with a composite primary key, and `is_manager_of(artist_id)` is the
predicate every RLS policy in the app already reads.

So the change is **additive, not a rewrite**:

1. Add a `role` column to `artist_managers` (rename it `artist_members`).
2. `is_manager_of()` keeps meaning "is a member of this artist" and every existing
   policy keeps working unchanged.
3. Add a narrower predicate (`has_artist_role(artist_id, role)`) and use it ONLY on
   the surfaces that actually split.

The global `profiles.role` (`admin` / `manager`) stays as it is. It is about Lone Star
staff, not about a person's relationship to an artist.

### Separate enquiries

`enquiries.purpose` already exists with a CHECK of `booking` / `demo` / `other`, and
`artist_mail_settings.booking_email` is already rung one of the recipient ladder. So
splitting the inbox by role extends machinery that exists rather than adding new
machinery.

Proposed default: booking goes to the manager, demo goes to both, everything else
goes to the artist.

**The sharp edge, and the rule that resolves it:** a split inbox means one party can
have mail the other cannot see. The music industry has a long and ugly history of a
manager sitting on an offer the artist never heard about. So:

> The inbox splits by DEFAULT VIEW. It does not create secrets from the account
> owner. The `owner` can always see every enquiry.

If the artist needs genuinely private mail that a manager cannot read, that is a
deliberate feature with its own name and its own consent, not a side effect of role
defaults. OPEN: does Sam want that?

### Contributors

A writer or designer is scoped to a **job**, not to an artist.

- Time-boxed. The grant expires when the job is delivered or the clock runs out.
- Sees the brand library and the specific fields they were hired to fill.
- Never sees enquiries, analytics, billing, or integrations.
- **Cannot publish.** Contributor work lands as a draft.

That last point reuses something already built: the review-and-approve window from
`SITE_EDITOR_PLAN.md`. A contributor's delivery is just another pending change in the
approval list. The writer fills the bio field, the owner approves it, it goes live.
No new publish path.

### Still to decide

The exact artist / manager edit split. Proposed starting point, to be corrected:

| Surface | Artist | Manager |
| --- | --- | --- |
| Bio, photos, brand | edit | view |
| What is on the site | edit | edit |
| Music, released flags | edit | edit |
| Tour dates | view | edit |
| Booking enquiries | view | edit |
| Analytics | view | view |
| Publish | ? | ? |
| Billing, invites | owner only | owner only |

Publish is the contested one. The artist arguably should hold the final word on
anything bearing their name, but the manager is usually the one doing the work.

## The packages

One base subscription plus a small number of NAMED packages. Three or four, not a
menu of fifteen line items.

### Base: the subscription

Everything already built. Site, visual editor, publishing and version history,
media library, music, tour, EPK, contact enquiries, analytics.

Priced low enough to be an easy yes. This is the thing they keep paying for
between releases, and the container everything else lands in.

### Add-on 1: Words

Human-written, by the founder or a vetted writer.

- Bio set: one-line, short (150 words), long (400 words)
- Press release template plus one release
- Tour announce copy
- Booking and sync one-sheet copy
- Playlist and blog pitch email

Delivered into the bio fields, not as a document.

### Add-on 2: Identity

Either built from nothing, or adopted and evolved from what exists.

- Logo (primary, secondary, mark) with vector files
- Type system: primary and secondary families
- Colour palette
- Usage rules: spacing, minimum sizes, what not to do
- Delivered as a **living brand book** inside Lone Star, not a PDF. PDFs die in
  Dropbox. A URL the whole team uses does not.

Feeds directly into the site style tokens that already exist.

### Add-on 3: Assets

Graphics and motion built on top of the identity.

- Cover art
- Spotify Canvas loops
- Poster and show-announce templates
- Instagram story and post templates
- Site graphics and motion

The templates matter more than the one-offs. A poster template the artist fills
with a city and a date is the thing that gets opened every month.

### Add-on 4: Full Launch

All three, plus press photography, run as a single onboarding. This is the Phase 1
product and the highest-value sale.

### Later, recurring

- Press photo refresh (annual)
- Per-release rollout pack: the calendar, the asset checklist, the copy, the art

## Gap detection: how add-ons sell themselves

The system already knows what is missing. The onboarding questionnaire and
`libraries[]` declaration planned in `SITE_EDITOR_PLAN.md` describe what a site
needs; the artist's data describes what exists. The difference is a sellable gap.

Examples:

| Signal | Prompt |
| --- | --- |
| Long bio field empty | "Your press page has no long bio. Get one written." |
| No press photo newer than 2 years | "Your press shots are from 2024." |
| Logo is a JPEG, no vector | "Your logo cannot be printed. Get vectors." |
| No Canvas on any released song | "Spotify Canvas raises saves. Get loops made." |

This is not an upsell. It is the answer to a problem the product just showed them.
Same declaration layer, two jobs: an empty editor field and a priced fix.

## Phases

**Phase 0: prove the work (now).**
Two or three artists, done entirely by hand, free or near-free, in exchange for
use as showcase. Skeen first. Goal is a portfolio and an honest picture of how
long each piece actually takes. Do things that do not scale, on purpose.

**Phase 1: sell Full Launch.**
High touch, few clients, founder-delivered. Learn which pieces repeat, which
always go wrong, and what people will actually pay for. Pricing discovered here.

**Phase 2: split into packages.**
Publish the three add-ons separately. Turn on gap detection. Recruit a small
vetted roster of writers and designers, with a margin on their work.

**Phase 3: make the assets keep working.**
Format derivatives (one master to every required size), on-brand templates,
delivery packs (press pack, DSP pack, booking pack). This is where human hours
stop scaling with revenue.

## Pricing shape

Numbers TBD after Phase 1. The shape:

- Base subscription: low monthly, easy yes
- Add-ons: one-off project fees, where most early revenue comes from
- Over time the recurring share grows and the project share shrinks as a
  percentage. That ratio is the health metric for the whole business.

## Already built vs needed

**Already built and reusable:** site editor and bridge, style tokens and fonts,
media library, publish history, EPK generation, analytics, contact enquiries.

**Needed for the service model:**

- Brand book surface (living, shareable, holds logo files and rules)
- Rights and credits fields on assets
- Onboarding questionnaire and gap detection
- Per-artist roles: a `role` column on `artist_managers`, plus a scoped, time-boxed
  contributor grant. See "Accounts, roles, and access" above. Roles were
  deliberately deferred; this is the reason they are no longer deferrable.
- Role-split enquiry inbox (extends `enquiries.purpose`, already in the schema)
- Format derivatives engine (Phase 3)
- Template renderer (Phase 3)

## Risks

1. **Becoming an agency.** Watch the recurring-to-project revenue ratio.
2. **Founder capacity.** Phase 0 is deliberately small for this reason.
3. **Freelance quality control.** A bad designer damages the artist's brand and
   ours. Small vetted roster, never an open marketplace.
4. **Churn after delivery.** The artist gets their logo and leaves. Defence: the
   site and the recurring surfaces are worth more the longer they are used.
5. **IP disputes.** Settled by the licence-not-ownership rule above, in writing,
   before the first paid job.

## Open questions

- ~~Who is the customer~~ ANSWERED 2026-08-21: the artist owns the account, paid for
  by themselves or by their manager. See "Accounts, roles, and access".
- Does the artist get genuinely private mail a manager cannot read, or does the
  owner always see everything?
- Who holds Publish: the artist, the manager, or either?
- Do designers work inside Lone Star, or deliver files that we ingest? Affects the
  contributor role and how hard Phase 2 is.
- Is Words founder-only for longer than the other add-ons, given it is the
  founder's own craft and the quality bar is personal?
- What is the minimum brand book that is genuinely more useful than a PDF?
