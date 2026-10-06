# Analytics accuracy: how close we are to PostHog, and what to fix next

Sam, 2026-10-05: "I want to be able to say, by the end, we are 90% similar or higher to
PostHog. I want to keep improving and searching for new ways to be more accurate."

PostHog runs beside our pipeline on Skeen's site as a second, independent count of the same
traffic (see TODO.md and `src/lib/compare-posthog.ts` for how the two are kept independent).
It is a yardstick, not the truth: it has blind spots of its own, so 100% is not the goal.
Where the two differ, the question is always WHICH ONE IS RIGHT, and only our side gets fixed.

## The number

    npm run compare:posthog -- skeen

prints `AGREEMENT n%`: the average of four overlaps. Views and clicks: the smaller count over
the larger. Sources and countries: how much the two breakdowns cover each other (Σ of the
smaller share per host or country). Reported, never gated. The window starts the day after
PostHog's first day for the site.

| date | overall | views | clicks | sources | countries | note |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-05 | 95% | 89% | 98% | 97% | 97% | Sep 18 to Oct 5, before bridge 0.46 |

Add a row after each change that should move it.

## Findings, 2026-10-05 (Skeen, Sep 18 to Oct 4, every view matched one by one)

- **Our door misses almost nothing.** PostHog recorded about 1 view in 1,000 that we did not.
  Clicks: 0 of 391.
- **The gap is views WE count that PostHog never does** (~120 of 1,126). They are not fans:
  only **1%** of them were followed by a click, against **33%** of views overall.
- **Why, from PostHog's own script** (array.js, read 2026-10-05): it sends its page view only
  once `document.visibilityState === "visible"`, and it drops every event from a browser with
  `navigator.webdriver` or a `HeadlessChrome` brand. We did neither, so we counted links opened
  in background tabs and closed unread, pages Safari preloaded while an address was typed,
  Chrome prerenders, and robots dressed as Chrome.
- **Hidden tabs looked at later**: ~50 views where we counted at load and PostHog counted when
  the tab was shown (median 4 minutes later, some hours). Same visit, different moment.
- **Ad blockers are NOT the gap.** EasyPrivacy blocks PostHog only on posthog.com hosts; the
  `/lsx` proxy dodges it. Our door (supabase.co) is on no list either.
- **Where it showed:** desktop Chrome (10% gap), mobile Safari (23%), Instagram's in-app
  browser only 4%. One fan in Jászberény, Hungary opened the site from YouTube 2-3 times a day:
  we counted 22, PostHog 5, always later than ours.

## Fixed

- **Bridge 0.46.0** (published and LIVE on Skeen 2026-10-05, ~04:45 UTC Oct 6): `landing()`
  waits until the page is shown, and an automated browser reports nothing. Tests:
  `tests/unit/analytics/site-bridge-pageviews.test.ts`. Expect Skeen's view count to drop a
  few percent from 2026-10-06. That is the fix. **Re-measure on or after 2026-10-13** with
  `npm run compare:posthog -- skeen --days 7` (only post-0.46 days), and add a row above.
- **The comparison window** starts after PostHog's first day, so the plain command no longer
  prints a false FAIL from the nine days before PostHog existed.

## Next ideas, roughly by value

1. **Re-measure after 0.46 (from 2026-10-13).** Whatever gap remains should be fast bounces (PostHog's
   ~100 KB script loads after our beacon) and real blockers: PostHog's blind spots, not ours.
2. **Repeat visits within a second.** 6 views where the same visitor landed twice inside 1s
   (likely a preload plus the real page). 0.46 should remove them; check after it ships.
3. **Countries.** ~2% of matched visits geolocate to different countries (ipinfo vs PostHog's
   MaxMind: TR/CY, MX/KR, GB/US), and 3 views have none (ipinfo failed 2026-09-22
   12:33-12:39 UTC). Idea: a second geo provider when the first fails.
4. **Our own visits.** The artist and team visiting their own site count on BOTH sides, so
   agreement never shows it, but it inflates both. Idea: a "don't count me" switch set from the
   dashboard.
5. **A repeatable gap finder.** The one-by-one matching above was a throwaway script. As
   `compare:posthog --gaps` it would list where the leftover views live after every change.
