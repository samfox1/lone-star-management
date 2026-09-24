/**
 * The effects runtime (0.40.0). Two jobs the effects stylesheet (effectsCss) cannot do
 * on its own:
 *
 * 1. MAGNETIC hover. `.hover-magnet` reads --lse-magnet-x/-y in its :hover transform;
 *    this is what writes them, from the pointer's offset to the element's centre, and
 *    clears them when the pointer leaves. Delegated on the document, so elements the
 *    editor restyles later are covered without a remount.
 * 2. TAP effects on iOS. Safari applies `:active` on touch only once SOMETHING in the
 *    document listens for touchstart; without a listener every tap rule is dead. A
 *    passive no-op listener is the whole fix.
 *
 * Mirrors mountEntrances' lifecycle: idempotent per document, teardown returned and
 * registry-checked so a stale handle cannot unregister a newer mount.
 */
import { KIDS_CLASS } from "./vocabulary";

/** The element a pointer event is magnetic FOR: a `.hover-magnet` that is not a marked
 *  container, or a child of one that is. Derived from the same marker the CSS uses. */
const MAGNET_SELECTOR = `.hover-magnet:not(.${KIDS_CLASS}),.${KIDS_CLASS}.hover-magnet > *`;
/** How far the element follows the pointer: a share of the pointer's offset from its
 *  centre. 0.35 reads as a lean, not a chase. */
const MAGNET_PULL = 0.35;

type Teardown = () => void;
const MOUNTED = new WeakMap<Document, Teardown>();

export function mountEffects(doc: Document): Teardown {
  MOUNTED.get(doc)?.();
  const cleanups: Teardown[] = [];
  const teardown = () => {
    for (const fn of cleanups.splice(0)) fn();
    if (MOUNTED.get(doc) === teardown) MOUNTED.delete(doc);
  };
  MOUNTED.set(doc, teardown);

  const touch = () => {};
  doc.addEventListener("touchstart", touch, { passive: true });
  cleanups.push(() => doc.removeEventListener("touchstart", touch));

  let active: HTMLElement | null = null;
  const rest = () => {
    if (!active) return;
    active.style.removeProperty("--lse-magnet-x");
    active.style.removeProperty("--lse-magnet-y");
    active = null;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>(MAGNET_SELECTOR) : null;
    if (target !== active) rest();
    if (!target) return;
    active = target;
    const r = target.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * MAGNET_PULL;
    const y = (e.clientY - (r.top + r.height / 2)) * MAGNET_PULL;
    target.style.setProperty("--lse-magnet-x", `${x.toFixed(1)}px`);
    target.style.setProperty("--lse-magnet-y", `${y.toFixed(1)}px`);
  };
  doc.addEventListener("pointermove", move, { passive: true });
  cleanups.push(() => doc.removeEventListener("pointermove", move));
  cleanups.push(rest);
  return teardown;
}
