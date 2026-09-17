/**
 * Fan-side analytics: the ONE way a connected site reports what a fan did.
 *
 * Every site — the Lone Star template, skeen, anything connected later — posts to the same
 * door, `POST {supabaseUrl}/functions/v1/event`, and the door derives everything else from
 * the request: which page, where the fan came from, where they are, what they browsed with,
 * whether they are a crawler, and a visitor hash that rotates daily. A site sends four
 * facts and nothing more. See docs/event-endpoint.md in lone-star-management.
 *
 * WHY THIS LIVES IN THE BRIDGE. Before it, each site hand-rolled its own reporting: skeen
 * sent page views, ticket clicks and buy clicks and nothing else, so its songs, videos and
 * social links reported nothing at all — for months, invisibly, because a missing event
 * looks exactly like a fan who never clicked. One helper, one contract, and a site's
 * coverage becomes something `checkContract` can check.
 *
 * Framework-free, like the rest of the package: plain `fetch`, no Supabase client, no React
 * and no Next import. Two ways to use it, and a site may mix them:
 *   • `attrs(type, entity)` spreads `data-*` onto a server-rendered element, and one
 *     delegated listener from `listen(document)` reports every click on them. Server
 *     components stay server components.
 *   • `track(type, entity)` reports directly, for a handler that already exists.
 */

/* ── The contract (PINNED copies; lone-star's tests/unit/analytics diff them) ─────── */

/** Mirrors src/lib/events.ts EVENT_TYPES and the door's derive.ts. */
export const EVENT_TYPES = [
  "view",
  "play",
  "link_click",
  "ticket_click",
  "buy_click",
  "video_click",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Mirrors src/lib/events.ts ENTITY_KINDS. The content row an event is about. */
export const ENTITY_KINDS = [
  "release",
  "track",
  "merch",
  "video",
  "tour_date",
  "link",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** The item an event is about: its kind and id, plus an optional human label kept only so
 *  a person reading the raw table can tell which song "…8f2a" was. */
export type TrackedEntity = { kind: EntityKind; id: string; label?: string };

/**
 * What an event is about. `entity` when a content row was clicked; `label` when nothing in
 * the database was — a social icon, a mailto, a checkout button. Plenty of real fan actions
 * have no row to point at, and without a label they arrive as anonymous `link_click`s among
 * hundreds of others. Give either, both, or neither.
 */
export type TrackOptions = { entity?: TrackedEntity; label?: string };

export type AnalyticsConfig = {
  /** `https://<project>.supabase.co` — the project's REST root. */
  supabaseUrl: string;
  /** The ANON key. Public by design: it is a speed bump on the door, not authorization. */
  anonKey: string;
  /** Which artist's site this is. */
  slug: string;
  /** The site's deployment environment, e.g. Vercel's `VERCEL_ENV`. Anything other than
   *  `production` reports nothing; absent is trusted. See `isReportableContext`. */
  environment?: string;
};

/** The editor shell, rendered inside lone-star's visual editor. A manager opening their own
 *  site to edit it is not a visit, and counting it would put their own work in their chart. */
const EDIT_ROUTE = "/edit";

export function isEditShell(pathname: string): boolean {
  return pathname === EDIT_ROUTE || pathname.startsWith(`${EDIT_ROUTE}/`);
}

/* ── Whose traffic counts ─────────────────────────────────────────────────────────── */

/** Enough of a `location` to judge whether this page load is a fan. */
export type ReportContext = { hostname: string; pathname: string };

/** Hosts that are always somebody's own machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x` — a laptop serving `next dev` to a phone on
 *  the same wifi, which is how a site gets checked on a real device. */
function isPrivateAddress(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Does this page load count as a fan visiting the artist's site?
 *
 * ONE definition, called by the door reporter AND by the PostHog mirror, because the
 * 30-day cross-check compares their two numbers. If they disagreed about what counts, a
 * month of someone running `next dev` would show up as one side over-counting and we would
 * spend the month investigating our own test traffic. `site-bridge-reportable.test.ts`
 * reads both files to prove neither re-implements this.
 *
 * It also closes finding 5 of the 2026-09-15 accuracy audit on its own merits: preview
 * deploys and local development were reporting into the artist's live chart.
 *
 * `environment` is the site's own deployment environment passed through: Vercel's
 * `VERCEL_ENV`, Netlify's `CONTEXT`, anything. A preview URL is an ordinary public https
 * host, so NOTHING about the hostname can reveal it; only the deployment can say.
 *
 * The rule is "only `production` reports", not "`preview` does not". A first draft listed
 * the non-production names, and a review pointed out that Netlify calls its previews
 * `deploy-preview` and `branch-deploy`: every host's own name for a preview would have
 * slipped through an allowlist of the ones we happened to know. ABSENT is still trusted,
 * because most connected sites never set it, and defaulting the other way would silently
 * switch their analytics off. The cost of that choice is real: a Vercel project with
 * "Automatically expose System Environment Variables" turned off passes nothing and its
 * previews report. `CONNECTING.md` §13 tells a site to check.
 */
export function isReportableContext(loc: ReportContext, environment?: string): boolean {
  if (isEditShell(loc.pathname)) return false;
  if (environment && environment !== "production") return false;
  const host = loc.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return false;
  return !isPrivateAddress(host);
}

/** The hostname a site's location gives us, however it was supplied. Browsers always have
 *  `hostname`; a caller that passes only an `href` (several of our own tests) gets it
 *  parsed out rather than being silently treated as unreportable. */
export function hostnameOf(loc: { hostname?: string; href?: string }): string {
  if (loc.hostname) return loc.hostname;
  try {
    return loc.href ? new URL(loc.href).hostname : "";
  } catch {
    return "";
  }
}

/** Every piece needed to report. A site missing its env vars must still RENDER — it simply
 *  reports nothing, the same choice `fetchPublicSite` makes. (Named for its module because
 *  public-site.ts has its own `isConfigured` for the read half of the contract.) */
export function isAnalyticsConfigured(c: Partial<AnalyticsConfig> | null | undefined): c is AnalyticsConfig {
  return Boolean(c && c.supabaseUrl && c.anonKey && c.slug);
}

/* ── data-* attributes: the seam for server-rendered elements ─────────────────────── */

export type TrackAttrs = {
  "data-track": EventType;
  "data-entity-kind"?: EntityKind;
  "data-entity-id"?: string;
  "data-label"?: string;
};

/**
 * Spread onto any element; its click reports. Typed, so an emitter cannot invent an event
 * name or forget the id — which is exactly how the hand-written ones drifted.
 */
export function trackAttrs(type: EventType, opts: TrackOptions = {}): TrackAttrs {
  const attrs: TrackAttrs = { "data-track": type };
  if (opts.entity) {
    attrs["data-entity-kind"] = opts.entity.kind;
    attrs["data-entity-id"] = opts.entity.id;
  }
  const label = opts.label ?? opts.entity?.label;
  if (label) attrs["data-label"] = label;
  return attrs;
}

/** Read back what `trackAttrs` wrote. Unknown or missing values yield null rather than a
 *  guess: a malformed attribute must not become a mystery row in someone's analytics. */
export function readTrackAttrs(
  dataset: Record<string, string | undefined>,
): { type: EventType; opts: TrackOptions } | null {
  const type = dataset.track;
  if (!type || !(EVENT_TYPES as readonly string[]).includes(type)) return null;
  const label = dataset.label;
  const opts: TrackOptions = label ? { label } : {};
  const kind = dataset.entityKind;
  const id = dataset.entityId;
  // A half-written entity degrades to a site-level event: better an unattributed click than
  // an invented id, which the door would reject and the reader would never explain.
  if (kind && id && (ENTITY_KINDS as readonly string[]).includes(kind)) {
    opts.entity = { kind: kind as EntityKind, id, ...(label ? { label } : {}) };
  }
  return { type: type as EventType, opts };
}

/* ── The request ──────────────────────────────────────────────────────────────────── */

export type EventBody = {
  slug: string;
  type: EventType;
  url: string;
  referrer: string;
  entity?: TrackedEntity;
  label?: string;
};

/**
 * What goes on the wire. `url` is the full `location.href` — the door takes the path, the
 * UTM tags and the site's own host from it, so a site never has to parse its own URL and
 * cannot disagree with the door about what page this was.
 */
export function eventBody(
  slug: string,
  type: EventType,
  opts: TrackOptions,
  loc: { href: string },
  referrer: string,
): EventBody {
  const label = opts.label ?? opts.entity?.label;
  return {
    slug,
    type,
    url: loc.href,
    referrer: referrer || "",
    ...(opts.entity ? { entity: opts.entity } : {}),
    ...(label ? { label } : {}),
  };
}

/**
 * A second, independent count of the same traffic, attached so that `track()` fans out to
 * it without every site having to remember. See mirror.ts — which implements this — for why
 * page views are deliberately NOT part of the fan-out.
 */
export type EventMirror = {
  capture: (type: EventType, opts: TrackOptions) => void;
};

export type SiteAnalytics = {
  /** Report a page view right now, with no de-duplication and no referrer rule. Most sites
   *  want `landing()`. */
  pageview: () => void;
  /**
   * Report that a fan LANDED on the site: a `view`, at most once per page load, and only
   * when the page was not reached from the site itself. Call it once on mount, from the
   * root layout. THE way a site reports views.
   *
   * WHAT A VIEW IS was Sam's call, 2026-09-17: "landing on the site should be the view.
   * I don't think switching pages should add to the view total." So:
   *   • arriving from another site, an app, a bookmark or a typed URL is a view;
   *   • moving inside the site is not: a client-side link never calls this again, and a
   *     plain link that reloads the page arrives with the site's own referrer;
   *   • a reload keeps the original referrer, so a fan who landed and reloads counts again.
   *
   * WHY A MEMORY ON THE PAGE. StrictMode mounts effects twice, and a component in a page
   * rather than the layout remounts. Both would re-send the landing. The memory lives on the
   * page's global object, keyed by slug (the lone-star template serves many artists from one
   * app), and only a real page load resets it.
   *
   * PostHog is never told this rule; see `capture_pageview` in mirror.ts and the comparison
   * query, which apply it independently to PostHog's own page views.
   */
  landing: () => void;
  /** Report a fan action, naming the row it was about, or just what it was called. */
  track: (type: EventType, opts?: TrackOptions) => void;
  /** `data-*` for a server-rendered element; `listen` turns its clicks into events. */
  attrs: typeof trackAttrs;
  /** One delegated, capture-phase click listener for every `attrs` element on the page.
   *  Returns the function that removes it again. */
  listen: (root: Document) => () => void;
};

/** No config, no reporting — and no crash. Every method is a no-op. */
function inert(): SiteAnalytics {
  return {
    pageview: () => {},
    landing: () => {},
    track: () => {},
    attrs: trackAttrs,
    listen: () => () => {},
  };
}

/** The slugs this page load has already reported a landing for. See `landing`. */
export type LandingMemory = Set<string>;

/** `Symbol.for`, not a module-level variable: two copies of the bridge on one page (a site
 *  and a dependency pinning different versions) must share one memory, or each reports
 *  the same landing once. */
const LANDING_MEMORY = Symbol.for("@samfox1/site-bridge.landingMemory");

function globalLandingMemory(): LandingMemory {
  const g = globalThis as { [LANDING_MEMORY]?: LandingMemory };
  return (g[LANDING_MEMORY] ??= new Set());
}

/** Hostnames from `URL` and `location` are already lower-case, so only `www.` needs removing. */
const bareHost = (host: string) => host.replace(/^www\./, "");

/**
 * Did this page load come from the site itself? The referrer's host against the page's,
 * `www.` ignored, compared WHOLE: a suffix or substring match would treat
 * `notskeenmusic.com` as internal and silently drop real arrivals. A subdomain is a
 * different site. No referrer, a malformed one, or no host to compare is never internal.
 */
export function isInternalReferrer(referrer: string, host: string): boolean {
  if (!referrer || !host) return false;
  try {
    return bareHost(new URL(referrer).hostname) === bareHost(host);
  } catch {
    return false;
  }
}

export type AnalyticsDeps = {
  /** Injected so tests can watch the wire without a network. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Defaults to the browser's. */
  location?: { href: string; pathname: string; hostname?: string };
  /** Defaults to `document.referrer`. */
  referrer?: () => string;
  /** Optional cross-check. Every reported event is offered to it; it decides what it
   *  wants. Absent on a site with no comparison running, which is the normal case. */
  mirror?: EventMirror;
  /** Where `landing` remembers what it sent. Defaults to one shared by the whole page;
   *  tests pass their own so one test's landing cannot silence the next test's. */
  landingMemory?: LandingMemory;
};

/**
 * Build the reporter for one site.
 *
 * Every send is FIRE-AND-FORGET: a failed report must never block a fan's navigation, and
 * must never reach their console. `keepalive` is the load-bearing detail — a plain fetch
 * started by a click on an outbound link is cancelled the moment the browser leaves the
 * page, which would silently lose exactly the ticket and buy clicks that matter most.
 */
export function createAnalytics(
  config: Partial<AnalyticsConfig> | null | undefined,
  deps: AnalyticsDeps = {},
): SiteAnalytics {
  if (!isAnalyticsConfigured(config)) return inert();
  const doFetch = deps.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  const loc = deps.location ?? (typeof location !== "undefined" ? location : undefined);
  if (!doFetch || !loc) return inert();
  const referrer =
    deps.referrer ?? (() => (typeof document !== "undefined" ? document.referrer : ""));

  const url = `${config.supabaseUrl.replace(/\/+$/, "")}/functions/v1/event`;

  const send = (type: EventType, opts: TrackOptions = {}): void => {
    // The door drops edit-shell events too; stopping here saves the request and keeps the
    // editor's own network tab quiet while a manager works. The same call decides local
    // development and preview deploys — see `isReportableContext`.
    if (!isReportableContext({ hostname: hostnameOf(loc), pathname: loc.pathname }, config.environment)) return;
    try {
      void doFetch(url, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
        body: JSON.stringify(eventBody(config.slug, type, opts, loc, referrer())),
      })?.catch?.(() => {});
    } catch {
      // A blocked fetch (an ad blocker, a strict CSP) is not the fan's problem.
    }
    try {
      deps.mirror?.capture(type, opts);
    } catch {
      // A measuring instrument must never break the thing it measures.
    }
  };

  return {
    pageview: () => send("view"),
    landing: () => {
      const memory = deps.landingMemory ?? globalLandingMemory();
      if (memory.has(config.slug)) return;
      if (isInternalReferrer(referrer(), hostnameOf(loc))) return;
      // Recorded only when it will actually be sent: a context that reports nothing (a
      // preview, localhost) must not use up the page's landing.
      if (!isReportableContext({ hostname: hostnameOf(loc), pathname: loc.pathname }, config.environment)) return;
      memory.add(config.slug);
      send("view");
    },
    track: send,
    attrs: trackAttrs,
    listen: (root: Document) => {
      const onClick = (e: Event) => {
        const el = (e.target as HTMLElement | null)?.closest?.("[data-track]") as
          | HTMLElement
          | null;
        if (!el) return;
        const parsed = readTrackAttrs(el.dataset as Record<string, string | undefined>);
        if (parsed) send(parsed.type, parsed.opts);
      };
      // Capture phase: a handler on the element that calls stopPropagation — a carousel, a
      // menu — must not also stop the event being counted.
      root.addEventListener("click", onClick, true);
      return () => root.removeEventListener("click", onClick, true);
    },
  };
}
