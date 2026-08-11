/**
 * Site-wide custom cursor + pointer trail (Sam, 2026-08-11: "choose a custom cursor
 * (default and on click)… and a cursor trail").
 *
 * Four ordinary `site_content` keys carry the whole feature — they upsert, publish,
 * ride get_public_site and `init-data` with zero migration (the payload's
 * `site_content` is an open map). A site calls `applyCursor(document,
 * cursorSettingsFrom(site.site_content))` once per payload; the editor previews live
 * through the additive `apply-cursor` message, which the frame routes to the same
 * applier. Both paths land here so the preview IS the published behaviour.
 *
 * `applyCursor` is idempotent per document: every call tears down the previous
 * mount before applying, so repeated messages never stack listeners or layers.
 */

export const CURSOR_CONTENT_KEYS = {
  image: "cursor_image",
  click: "cursor_click_image",
  trail: "cursor_trail",
  trailColor: "cursor_trail_color",
} as const;

export const CURSOR_TRAIL_STYLES = ["image", "dots", "line", "sparkles"] as const;
export type CursorTrailStyle = (typeof CURSOR_TRAIL_STYLES)[number];

export type CursorSettings = {
  /** URL of the resting cursor PNG; '' means the browser default. */
  image: string;
  /** URL swapped in while the pointer is down; '' means no swap. */
  clickImage: string;
  /** One of CURSOR_TRAIL_STYLES, or '' for no trail. */
  trail: CursorTrailStyle | "";
  /** Hex for dots / line / sparkles; '' falls back to near-black. */
  trailColor: string;
};

const isTrailStyle = (v: string): v is CursorTrailStyle =>
  (CURSOR_TRAIL_STYLES as readonly string[]).includes(v);

/** Read the settings out of a payload's `site_content` map. Unknown trail values
 *  degrade to '' — an older site fed by a newer editor must never throw. */
export function cursorSettingsFrom(
  content: Record<string, string | undefined> | null | undefined,
): CursorSettings {
  const c = content ?? {};
  const trail = c[CURSOR_CONTENT_KEYS.trail] ?? "";
  return {
    image: c[CURSOR_CONTENT_KEYS.image] ?? "",
    clickImage: c[CURSOR_CONTENT_KEYS.click] ?? "",
    trail: isTrailStyle(trail) ? trail : "",
    trailColor: c[CURSOR_CONTENT_KEYS.trailColor] ?? "",
  };
}

/** Same normalization for a wire-shaped object (the `apply-cursor` message), because
 *  the frame's message guard is deliberately loose about payload interiors. */
export function normalizeCursorSettings(u: unknown): CursorSettings {
  const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const trail = str(o.trail);
  return {
    image: str(o.image),
    clickImage: str(o.clickImage),
    trail: isTrailStyle(trail) ? trail : "",
    trailColor: str(o.trailColor),
  };
}

/** CSS cursor value for an image URL. The 4 4 hotspot keeps a small glyph clicking
 *  near its visual centre-ish rather than its top-left corner. */
const cursorValue = (url: string) => `url("${url.replace(/"/g, "%22")}") 4 4, auto`;

/** Browsers ignore `cursor: url()` images larger than 128px (and some cap far lower),
 *  which would turn an uploaded 1000px PNG into a silent default arrow. Downscale
 *  oversized images to 32px through a canvas, best-effort: cross-origin taint or a
 *  load failure just keeps the raw URL. */
const CURSOR_MAX_NATIVE = 64;
const CURSOR_DRAW_SIZE = 32;
/** The pure half of the downscale decision, exported so it can be pinned directly —
 *  jsdom's Image never fires onload, so the loader around it is untestable there. */
export const needsDownscale = (w: number, h: number): boolean =>
  w > CURSOR_MAX_NATIVE || h > CURSOR_MAX_NATIVE;
function fittedCursorUrl(doc: Document, url: string, cb: (fitted: string) => void): void {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (!needsDownscale(img.naturalWidth, img.naturalHeight)) return;
    try {
      const canvas = doc.createElement("canvas");
      canvas.width = CURSOR_DRAW_SIZE;
      canvas.height = CURSOR_DRAW_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, CURSOR_DRAW_SIZE, CURSOR_DRAW_SIZE);
      cb(canvas.toDataURL("image/png"));
    } catch {
      /* tainted canvas — keep the raw URL and let the browser decide */
    }
  };
  img.src = url;
}

const TRAIL_FALLBACK_COLOR = "#111111";
const TRAIL_NODE_CAP = 48;
const TRAIL_SPAWN_GAP_MS = 24;
const TRAIL_NODE_LIFE_MS = 650;
const LINE_POINT_LIFE_MS = 400;

type Teardown = () => void;
const MOUNTED = new WeakMap<Document, Teardown>();

/**
 * Apply (or clear) the cursor settings on a document. Safe to call on every
 * `init-data` and every `apply-cursor`; each call replaces the previous mount.
 * Returns a teardown, though callers that just re-apply never need it.
 */
export function applyCursor(doc: Document, settings: CursorSettings): Teardown {
  MOUNTED.get(doc)?.();
  MOUNTED.delete(doc);

  const root = doc.documentElement;
  const win = doc.defaultView;
  const cleanups: Teardown[] = [];
  // `disposed` neutralizes the async image-fit callbacks below: they may resolve after
  // this mount was replaced, and writing a stale cursor onto the shared documentElement
  // would show cursor A while the panel and DB say B (found in review, 2026-08-11).
  let disposed = false;
  const teardown = () => {
    disposed = true;
    for (const fn of cleanups.splice(0)) fn();
    // Only unregister OURSELVES. A stale handle held by a caller must not delete the
    // registration of whatever mount replaced us — the next applyCursor would then
    // find nothing to tear down and the replacement's listeners would leak forever.
    if (MOUNTED.get(doc) === teardown) MOUNTED.delete(doc);
  };
  MOUNTED.set(doc, teardown);

  // ── the cursor itself ────────────────────────────────────────────────────────
  let restingValue = settings.image ? cursorValue(settings.image) : "";
  const setResting = () => {
    if (restingValue) root.style.cursor = restingValue;
    else root.style.removeProperty("cursor");
  };
  setResting();
  cleanups.push(() => root.style.removeProperty("cursor"));
  if (settings.image)
    fittedCursorUrl(doc, settings.image, (fitted) => {
      if (disposed) return;
      restingValue = cursorValue(fitted);
      if (!pressed) setResting();
    });

  let pressed = false;
  if (settings.clickImage && win) {
    let clickValue = cursorValue(settings.clickImage);
    fittedCursorUrl(doc, settings.clickImage, (fitted) => {
      if (disposed) return;
      clickValue = cursorValue(fitted);
      if (pressed) root.style.cursor = clickValue;
    });
    const down = () => {
      pressed = true;
      root.style.cursor = clickValue;
    };
    const up = () => {
      pressed = false;
      setResting();
    };
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
    win.addEventListener("blur", up);
    cleanups.push(() => {
      doc.removeEventListener("pointerdown", down, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", up, true);
      win.removeEventListener("blur", up);
    });
  }

  // ── the trail ────────────────────────────────────────────────────────────────
  // An image trail with no image to trail degrades to nothing, not to a broken <img>.
  const trail = settings.trail === "image" && !settings.image ? "" : settings.trail;
  const reducedMotion = !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!trail || !win || reducedMotion) return teardown;

  const color = settings.trailColor || TRAIL_FALLBACK_COLOR;

  if (trail === "line") {
    const canvas = doc.createElement("canvas");
    canvas.setAttribute("data-lse-cursor-trail", "line");
    canvas.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    doc.body.appendChild(canvas);
    const points: { x: number; y: number; t: number }[] = [];
    let raf = 0;
    const size = () => {
      canvas.width = win.innerWidth;
      canvas.height = win.innerHeight;
    };
    size();
    win.addEventListener("resize", size);
    const draw = () => {
      raf = 0;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();
      while (points.length && now - points[0].t > LINE_POINT_LIFE_MS) points.shift();
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      for (let i = 1; i < points.length; i++) {
        const age = (now - points[i].t) / LINE_POINT_LIFE_MS;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.lineWidth = 3 * (1 - age) + 1;
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
      if (points.length) raf = win.requestAnimationFrame(draw);
    };
    const move = (e: PointerEvent) => {
      points.push({ x: e.clientX, y: e.clientY, t: Date.now() });
      if (!raf) raf = win.requestAnimationFrame(draw);
    };
    doc.addEventListener("pointermove", move);
    cleanups.push(() => {
      doc.removeEventListener("pointermove", move);
      win.removeEventListener("resize", size);
      if (raf) win.cancelAnimationFrame(raf);
      canvas.remove();
    });
    return teardown;
  }

  // dots / image / sparkles: short-lived nodes in a fixed layer.
  const layer = doc.createElement("div");
  layer.setAttribute("data-lse-cursor-trail", trail);
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  doc.body.appendChild(layer);
  let lastSpawn = 0;
  const move = (e: PointerEvent) => {
    const now = Date.now();
    if (now - lastSpawn < TRAIL_SPAWN_GAP_MS || layer.childElementCount >= TRAIL_NODE_CAP)
      return;
    lastSpawn = now;
    let node: HTMLElement;
    if (trail === "image") {
      const img = doc.createElement("img");
      img.src = settings.image;
      img.alt = "";
      img.style.width = "22px";
      img.style.height = "22px";
      node = img;
    } else if (trail === "sparkles") {
      node = doc.createElement("span");
      node.textContent = "✦";
      node.style.color = color;
      node.style.fontSize = `${10 + Math.round(Math.random() * 8)}px`;
      node.style.rotate = `${Math.round(Math.random() * 90 - 45)}deg`;
    } else {
      node = doc.createElement("div");
      node.style.width = "8px";
      node.style.height = "8px";
      node.style.borderRadius = "50%";
      node.style.background = color;
    }
    const jitter = trail === "sparkles" ? 10 : 0;
    node.style.position = "absolute";
    node.style.left = `${e.clientX + (Math.random() * 2 - 1) * jitter}px`;
    node.style.top = `${e.clientY + (Math.random() * 2 - 1) * jitter}px`;
    node.style.transform = "translate(-50%,-50%)";
    node.style.transition = `opacity ${TRAIL_NODE_LIFE_MS}ms ease-out, scale ${TRAIL_NODE_LIFE_MS}ms ease-out`;
    layer.appendChild(node);
    // Two frames so the transition has a painted "from" state to leave.
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        node.style.opacity = "0";
        node.style.scale = "0.3";
      }),
    );
    win.setTimeout(() => node.remove(), TRAIL_NODE_LIFE_MS + 100);
  };
  doc.addEventListener("pointermove", move);
  cleanups.push(() => {
    doc.removeEventListener("pointermove", move);
    layer.remove();
  });
  return teardown;
}
