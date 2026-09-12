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
};

/** The editor shell, rendered inside lone-star's visual editor. A manager opening their own
 *  site to edit it is not a visit, and counting it would put their own work in their chart. */
const EDIT_ROUTE = "/edit";

export function isEditShell(pathname: string): boolean {
  return pathname === EDIT_ROUTE || pathname.startsWith(`${EDIT_ROUTE}/`);
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

export type SiteAnalytics = {
  /** Report a page view. The site decides when — once per load, or per route change. */
  pageview: () => void;
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
  return { pageview: () => {}, track: () => {}, attrs: trackAttrs, listen: () => () => {} };
}

export type AnalyticsDeps = {
  /** Injected so tests can watch the wire without a network. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Defaults to the browser's. */
  location?: { href: string; pathname: string };
  /** Defaults to `document.referrer`. */
  referrer?: () => string;
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
    // editor's own network tab quiet while a manager works.
    if (isEditShell(loc.pathname)) return;
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
  };

  return {
    pageview: () => send("view"),
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
