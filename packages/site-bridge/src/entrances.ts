/**
 * The entrance-animation runtime (slice 3, 2026-08-11). The CSS half lives in
 * tokens.css (effectsCss): an element carrying an `enter-*` class is held at its
 * hidden "from" state ONLY while `html[data-lse-entrances]` is set — this module is
 * what sets it, then releases each element (`data-lse-entered`) as it scrolls into
 * view. The guard is the safety story: a site that never mounts this shows all its
 * content, instead of hiding it forever behind an animation that can't fire.
 *
 * Mirrors applyCursor's lifecycle: idempotent per document, teardown returned and
 * registry-checked so a stale handle can't unregister a newer mount.
 */
import { ENTRANCE_OPTIONS } from "./vocabulary";

export const ENTRANCES_ROOT_ATTR = "data-lse-entrances";
export const ENTERED_ATTR = "data-lse-entered";

/** Derived from the option table — a new entrance is observed the day it exists. */
const ENTRANCE_SELECTOR = ENTRANCE_OPTIONS.filter((o) => o.value)
  .map((o) => `.${o.value}`)
  .join(",");

type Teardown = () => void;
const MOUNTED = new WeakMap<Document, Teardown>();
/** The active observer per document, so replayEntrances can re-arm an element. */
const OBSERVERS = new WeakMap<Document, IntersectionObserver>();

/**
 * Arm entrance animations on a document. Safe to call repeatedly; each call replaces
 * the previous mount. Elements animate ONCE — re-entering the viewport does not
 * replay (a tour table re-animating on every scroll reads as flicker, not craft).
 */
export function mountEntrances(doc: Document): Teardown {
  MOUNTED.get(doc)?.();

  const win = doc.defaultView;
  const cleanups: Teardown[] = [];
  const teardown = () => {
    for (const fn of cleanups.splice(0)) fn();
    if (MOUNTED.get(doc) === teardown) {
      MOUNTED.delete(doc);
      OBSERVERS.delete(doc);
    }
  };
  MOUNTED.set(doc, teardown);

  // No window or no IntersectionObserver (very old browsers, some test envs): never
  // set the root attribute — the hidden state stays inert and everything is visible.
  if (!win || typeof win.IntersectionObserver !== "function") return teardown;

  doc.documentElement.setAttribute(ENTRANCES_ROOT_ATTR, "");
  cleanups.push(() => doc.documentElement.removeAttribute(ENTRANCES_ROOT_ATTR));

  const io = new win.IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute(ENTERED_ATTR, "");
        io.unobserve(e.target);
      }
    },
    // Fire when a sliver is really on screen — 0 fires for offscreen-but-adjacent.
    { threshold: 0.15 },
  );
  OBSERVERS.set(doc, io);
  cleanups.push(() => io.disconnect());

  const observe = (el: Element) => {
    if (!el.hasAttribute(ENTERED_ATTR)) io.observe(el);
  };
  doc.querySelectorAll(ENTRANCE_SELECTOR).forEach(observe);

  // New or re-classed elements join the watch: the editor applies entrance classes
  // long after mount, and a site's own client renders keep adding regions.
  const mo = new win.MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target instanceof win.Element) {
        if (r.target.matches(ENTRANCE_SELECTOR)) observe(r.target);
      } else {
        for (const node of r.addedNodes) {
          if (!(node instanceof win.Element)) continue;
          if (node.matches(ENTRANCE_SELECTOR)) observe(node);
          node.querySelectorAll?.(ENTRANCE_SELECTOR).forEach(observe);
        }
      }
    }
  });
  mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  cleanups.push(() => mo.disconnect());

  return teardown;
}

/**
 * Replay EVERY entrance on the document — the editor's "Replay motion" button:
 * entrances play once, so without this there is no way to re-watch what a fan sees
 * on page load short of reloading the frame.
 */
export function replayAllEntrances(doc: Document): void {
  replayEntrances(doc, ENTRANCE_SELECTOR)
}

/**
 * Replay the entrance of every element matching `selector` (the editor's preview:
 * picking "Rise" should SHOW the rise, not silently mark the region entered). No-op
 * on a document with no mounted runtime.
 */
export function replayEntrances(doc: Document, selector: string): void {
  const io = OBSERVERS.get(doc);
  if (!io) return;
  doc.querySelectorAll(selector).forEach((el) => {
    if (!el.matches(ENTRANCE_SELECTOR)) return;
    el.removeAttribute(ENTERED_ATTR);
    // Two frames so the hidden state paints before the observer releases it — without
    // the round trip the attribute flips back within one frame and nothing moves.
    const win = doc.defaultView;
    if (!win) return;
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => io.observe(el)));
  });
}
