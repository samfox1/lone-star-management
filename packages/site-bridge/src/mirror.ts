/**
 * The cross-check mirror: a SECOND, independent count of the same traffic.
 *
 * WHY THIS EXISTS. A 2026-09-15 audit of our own analytics found the math correct — the
 * nightly tallies match the raw rows exactly — but could not answer the question underneath
 * it: is a recorded view a real fan? Nothing inside a pipeline can tell you that. Only a
 * second pipeline, counting the same traffic by different rules, can. This module is that
 * second pipeline, and it is temporary by design: run it beside the door for 30 days,
 * compare, tune whatever disagrees, then delete the key and the module goes inert.
 *
 * WHAT INDEPENDENCE MEANS HERE, because the original plan got it wrong. ANALYTICS_PAGE_PLAN
 * §"PostHog cross-check" had PostHog loaded with `capture_pageview: false` and a page view
 * MIRRORED from our own `track()` call. That is not a cross-check, it is a copy: if we send
 * a view twice, PostHog records it twice, and the comparison agrees with us at exactly the
 * moment it should be shouting. So:
 *
 *   • PAGE VIEWS are PostHog's own, captured by its script from the browser's history API.
 *     We never send it a `view`. The two counts then share nothing but the fan, which is
 *     the only way a gap means anything.
 *   • CLICKS are mirrored, because there is no independent source for an entity id — only
 *     our own markup knows which song "…8f2a" was. That comparison tests a different seam:
 *     the DOOR. An event PostHog kept and our tables lack was dropped by a rate cap
 *     (60/min per IP, 120/min per artist) or refused by validation, and on a gig night that
 *     is exactly when it would happen and exactly when nobody would notice.
 *
 * Framework-free and dependency-free, like the rest of the package: no `posthog-js` import,
 * no React, no bundler step. A site that sets no key pays nothing — not a request, not a
 * byte of script.
 */

import {
  hostnameOf,
  isReportableContext,
  type EventType,
  type TrackOptions,
} from "./analytics";

/** PostHog Cloud US. The EU project host is `https://eu.i.posthog.com`. */
export const DEFAULT_MIRROR_HOST = "https://us.i.posthog.com";

/** Marks our script tag so a second mount finds it instead of adding another. */
export const MIRROR_SCRIPT_MARK = "data-lse-mirror";

export type MirrorConfig = {
  /** The PostHog PROJECT key, `phc_…`. Public by design, like the Supabase anon key. */
  key: string;
  /** Which artist's site this is; every mirrored event carries it as `site`. */
  slug: string;
  /** The project's API host. Defaults to PostHog Cloud US. Point this at the site's own
   *  domain to proxy PostHog and stop ad blockers suppressing only this half of the
   *  comparison; `assetHostFor` leaves such a host alone on purpose. */
  host?: string;
  /** The site's deployment environment, as on `AnalyticsConfig`. Both pipelines must read
   *  the SAME value, or the cross-check invents a gap out of our own test traffic. */
  environment?: string;
};

/** The slice of `posthog-js` we use. Typed here so the package needs no dependency; each
 *  method was checked present in the shipped array.js on 2026-09-16. */
export type PostHogLike = {
  init: (key: string, options: MirrorInitOptions) => void;
  capture: (event: string, properties?: Record<string, string>) => void;
  /** Super-properties: sent with EVERY event PostHog captures, its own `$pageview`s
   *  included. The only way a page view we never touch can carry the artist's slug. */
  register: (properties: Record<string, string>) => void;
};

export type MirrorInitOptions = {
  api_host: string;
  /** `true`: PostHog counts one page view per page load by itself, none on navigation. */
  capture_pageview: true;
  /** `'memory'` — no cookie, no localStorage, no banner. Cookieless like the door, but NOT
   *  the same count: the door's hash is stable for a UTC day across page loads, while this
   *  mints a new id on every page load. So PostHog "users" ≈ page loads, and unique-visitor
   *  numbers between the two are never comparable. Only event counts are. */
  persistence: "memory";
  autocapture: false;
  disable_session_recording: true;
  disable_surveys: true;
};

export type MirrorDeps = {
  window?: Window & { posthog?: PostHogLike };
  document?: Document;
  location?: { pathname: string; hostname?: string; href?: string };
};

/** The surface a reporter needs. `createAnalytics` takes one of these as `mirror`. */
export type SiteMirror = {
  capture: (type: EventType, opts: TrackOptions) => void;
  /** Stop mirroring — a late-loading script will not flush the queue after this. */
  shutdown: () => void;
};

export function isMirrorConfigured(
  c: Partial<MirrorConfig> | null | undefined,
): c is MirrorConfig {
  return Boolean(c && c.key && c.slug);
}

/**
 * Where the script itself lives. PostHog Cloud answers the API on `us.i.posthog.com` but
 * serves assets from the sibling `us-assets.i.posthog.com`; a site that reverse-proxies
 * PostHog through its own domain to survive ad blockers has no such sibling and serves
 * both from one host. Guessing wrong 404s the script and the mirror is silently dead,
 * which is the one failure this module cannot afford — so the rewrite is narrow, and
 * anything that is not a PostHog Cloud host is left exactly as given.
 */
export function assetHostFor(host: string): string {
  const trimmed = host.replace(/\/+$/, "");
  return trimmed.replace(
    /^(https?:\/\/)([a-z0-9-]+)\.i\.posthog\.com$/i,
    "$1$2-assets.i.posthog.com",
  );
}

export function mirrorInitOptions(config: MirrorConfig): MirrorInitOptions {
  return {
    api_host: (config.host ?? DEFAULT_MIRROR_HOST).replace(/\/+$/, ""),
    // A view is landing on the site, not switching pages (Sam, 2026-09-17), so one per page
    // load and none on client-side navigation. PostHog applies no referrer rule here: it
    // stamps `$referring_domain` on the page view itself, and the comparison query drops
    // same-site ones. Two programs applying the rule is what keeps the counts independent.
    capture_pageview: true,
    persistence: "memory",
    // A cross-check needs counts, nothing else. Autocapture would also bury the mirrored
    // clicks among thousands of raw DOM ones.
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
  };
}

/**
 * The properties a mirrored click carries. Absent facts are OMITTED rather than sent
 * empty: an `entity_id: ""` collects every unattributed click into one phantom row that
 * looks, in a breakdown, like a wildly popular piece of content.
 */
export function mirrorProps(slug: string, opts: TrackOptions): Record<string, string> {
  const label = opts.label ?? opts.entity?.label;
  return {
    site: slug,
    ...(opts.entity ? { entity_kind: opts.entity.kind, entity_id: opts.entity.id } : {}),
    ...(label ? { label } : {}),
  };
}

/** No key, no editor, no browser — no mirror, and no crash. */
function inert(): SiteMirror {
  return { capture: () => {}, shutdown: () => {} };
}

/**
 * ONE PostHog per page, shared by every mirror created on it.
 *
 * WHY SHARED. A review found three bugs in a draft that kept this state per mirror and only
 * shared the script tag. A second mirror saw `window.posthog` and went ready without
 * knowing whether `init` had run or thrown, so it could capture into an uninitialised
 * client. It attached a `load` listener to a script that had already fired, and waited
 * forever. And two mirrors waiting on one script each called `init`. All three were one
 * mistake: the thing that knows whether PostHog is ready is the page, not the mirror.
 *
 * WHY `Symbol.for` ON THE WINDOW. React StrictMode mounts an effect twice, and a template
 * that mounts analytics in a page remounts on every navigation. Two copies of the bridge
 * at different versions must see one loader too.
 */
const LOADER = Symbol.for("@samfox1/site-bridge.posthogLoader");

type LoaderStatus =
  /** The script tag is in the page and has not fired `load`. */
  | "loading"
  /** It fired while no mirror was alive to want it, so `init` has not run. */
  | "loaded"
  /** `init` ran and `register` tagged every future event with the slug. */
  | "ready"
  /** The script defined nothing, `init` threw, or no script could be placed. For good. */
  | "dead";

type Loader = {
  key: string;
  host: string;
  slug: string;
  status: LoaderStatus;
  /** Live mirrors waiting on the outcome. A shut-down mirror removes itself. */
  waiters: Set<() => void>;
};

type LoaderWindow = Window & { posthog?: PostHogLike; [LOADER]?: Loader };

/** Run `init` exactly once, for the whole page, and tell every waiting mirror the result. */
function settle(win: LoaderWindow, loader: Loader, config: MirrorConfig): void {
  // No re-entry guard, on purpose: the two callers are a `{ once: true }` load listener and
  // the `loaded` branch, and both leave the status ready or dead. A guard here survived
  // every mutation run because nothing can reach it, and an unreachable check is one a
  // later reader will trust to protect something.
  // array.js installs its global as it executes, so absent at `load` is absent for good:
  // a CSP that served an empty body, a proxy answering with its own 200, an extension that
  // stubbed it out. Going ready here would capture every later click into nothing.
  const ph = win.posthog;
  if (!ph) {
    loader.status = "dead";
  } else {
    try {
      ph.init(loader.key, mirrorInitOptions(config));
      // Before anything else is captured: PostHog's own first `$pageview` fires from init,
      // and it must already carry the slug the comparison filters on.
      ph.register({ site: loader.slug });
      loader.status = "ready";
    } catch {
      // A half-initialised client is not one to capture into. Dead is the honest answer.
      loader.status = "dead";
    }
  }
  for (const wake of Array.from(loader.waiters)) wake();
}

/**
 * Load PostHog and return the mirror.
 *
 * Everything here is best-effort. The mirror is a measuring instrument attached to someone
 * else's website; a blocked script, a hostile extension or a CSP that refuses the CDN must
 * cost the fan nothing and must never reach their console.
 */
export function createMirror(
  config: Partial<MirrorConfig> | null | undefined,
  deps: MirrorDeps = {},
): SiteMirror {
  if (!isMirrorConfigured(config)) return inert();

  const win = (deps.window ?? (typeof window !== "undefined" ? window : undefined)) as
    | LoaderWindow
    | undefined;
  const doc = deps.document ?? (typeof document !== "undefined" ? document : undefined);
  const loc = deps.location ?? win?.location;
  if (!win || !doc || !loc) return inert();

  // THE SAME RULE the door reporter uses, deliberately not a copy of it: the editor shell,
  // local development, and preview deploys. If the mirror kept traffic the door drops,
  // PostHog would show visits we do not have, and the gap would be misread as us
  // under-counting — the comparison inventing its own failure out of our own laptops.
  if (!isReportableContext({ hostname: hostnameOf(loc), pathname: loc.pathname }, config.environment)) {
    return inert();
  }

  const host = (config.host ?? DEFAULT_MIRROR_HOST).replace(/\/+$/, "");
  let loader = win[LOADER];
  if (loader) {
    // One PostHog project per page. A second mirror naming a different project, host or
    // artist would otherwise report into the FIRST one's project under the first one's
    // slug, and nothing would ever say so.
    if (loader.key !== config.key || loader.host !== host || loader.slug !== config.slug) {
      return inert();
    }
  } else {
    const created: Loader = { key: config.key, host, slug: config.slug, status: "loading", waiters: new Set() };
    loader = created;
    win[LOADER] = created;
    try {
      const script = doc.createElement("script");
      script.async = true;
      script.src = `${assetHostFor(host)}/static/array.js`;
      script.setAttribute(MIRROR_SCRIPT_MARK, config.slug);
      script.addEventListener(
        "load",
        () => {
          // Only start PostHog if some mirror still wants it. Otherwise a script that
          // arrives after its page unmounted would begin capturing `$pageview`s for a
          // session nothing on our side is reporting. The next mirror settles it instead.
          if (created.waiters.size > 0) settle(win, created, config);
          else created.status = "loaded";
        },
        { once: true },
      );
      // No `error` handler: an unreachable CDN never fires `load`, so waiters stay queued
      // (capped) and silent, which is already correct.
      doc.head.appendChild(script);
    } catch {
      // A document that refuses to make or place a script. Not the site's render's problem.
      created.status = "dead";
    }
  }
  const shared = loader;

  let stopped = false;
  /**
   * Clicks made before PostHog was ready. KNOWN LOSS, stated so nobody reads it as a
   * guarantee: this queue lives in the page, so a click that navigates away before the
   * script loads (an outbound ticket link in the first second) dies with it, while the
   * door's `keepalive` fetch survives. That biases PostHog LOW on those clicks. It does not
   * corrupt the comparison, because the gate is on the other direction: a click PostHog
   * kept and our tables lack can only be a door-side drop.
   */
  const pending: Array<[EventType, TrackOptions]> = [];
  /** A request that hangs forever fires nothing; an uncapped queue would grow all session. */
  const PENDING_MAX = 50;

  const emit = (type: EventType, opts: TrackOptions): void => {
    try {
      win.posthog?.capture(type, mirrorProps(config.slug, opts));
    } catch {
      // An extension that replaced `capture` with a thrower is not the fan's problem.
    }
  };

  const wake = (): void => {
    shared.waiters.delete(wake);
    if (!stopped && shared.status === "ready") for (const [type, opts] of pending) emit(type, opts);
    pending.length = 0;
  };

  if (shared.status === "loading") shared.waiters.add(wake);
  else if (shared.status === "loaded") {
    shared.waiters.add(wake);
    settle(win, shared, config);
  }

  return {
    capture: (type, opts = {}) => {
      if (stopped) return;
      // PostHog counts page views itself. Mirroring one would make its count a copy of
      // ours, and a copy cannot disagree — see the note at the top of this file.
      if (type === "view") return;
      if (shared.status === "ready") emit(type, opts);
      else if (shared.status !== "dead" && pending.length < PENDING_MAX) pending.push([type, opts]);
    },
    shutdown: () => {
      stopped = true;
      pending.length = 0;
      shared.waiters.delete(wake);
    },
  };
}
