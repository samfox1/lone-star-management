// @vitest-environment jsdom
// PORTED from skeen's lib/frameBridge.test.ts (SITE_BRIDGE_PLAN.md phase 1 slice 2) — the tests move
// with the code they pin. skeen keeps its copies until its phase-2 migration deletes
// them WITH its mirrored modules; the double coverage in the window is deliberate.
// Registry-dependent cases use TEST_REGIONS below — the package takes a site's
// registry by injection, so the tests inject one too.

import { describe, expect, it, vi } from "vitest";
import {
  BRIDGE_VERSION,
  applyFieldToDom,
  applyHighlightToDom,
  applyLinkToDom,
  applyStyleToDom,
  clearHighlightFromDom,
  mountFrameBridge,
  EDITOR_SOURCE,
  READY_RETRIES,
  READY_RETRY_MS,
  REVEAL_TIMEOUT_MS,
  highlightSelector,
  markedAncestor,
  targetOf,
  textFieldKeys,
} from "@samfox1/site-bridge";
import { createStyleApplier, type TemplateManifest } from "@samfox1/site-bridge";
import { FIELD_ATTR, HIGHLIGHT_ATTR } from "@samfox1/site-bridge/markers";

/** Post an editor message at the frame, the way the real editor does. */
function editorSays(msg: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://editor.test",
      data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, ...msg },
    }),
  );
}

// A minimal edit list in the PACKAGE's shape. skeen's tests pinned its real EDIT_LIST —
// its design; those assertions stayed there. What the bridge owes any site is that the
// list it is HANDED is the list it announces, verbatim — which a fixture proves better,
// because nothing here can drift with skeen's layout.
const EDIT_LIST = {
  template: "test-site",
  fields: [
    { key: "polaroid_1_caption", label: "Caption", type: "text" as const, target: { store: "site_content" as const, key: "polaroid_1_caption" } },
    { key: "polaroid_1_photo", label: "Photo", type: "image" as const, target: { store: "site_content" as const, key: "polaroid_1_photo" } },
  ],
  slots: [],
  styles: [
    { key: "work_section", label: "Music section", base: "relative z-0" },
    { key: "hero_video", label: "Hero video", base: "" },
  ],
  links: [],
  components: [{ key: "polaroid", label: "Polaroid", count: 5, slots: [{ key: "photo", label: "Photo" }] }],
  styleOptions: { textColors: [{ value: "text-flash-1", label: "Flash", hex: "#2563eb" }] },
} satisfies TemplateManifest & { styleOptions: { textColors: { hex: string }[] } };

// The registry inversion, post-deepening: no setter exists — a test (like a site)
// CONSTRUCTS its binding. Bare applyStyleToDom calls below that need the registry use
// this instance; mount-driven tests pass `regionBase` as the option. No module state,
// no cross-test wipe lines (both existed here before 2026-08-07, and were the smell).
const TEST_BASES: Record<string, string> = {
  work_section: "relative z-0",
  // A DECLARED base for the hero clip, so the reset test can prove the snapshot comes
  // from the registry and not the live class attribute (which carries the transient
  // opacity-0 the whole lesson is about).
  hero_video: "absolute inset-0 h-full w-full object-cover",
};
const regionBase = (key: string): string => TEST_BASES[key] ?? "";
const boundApplier = createStyleApplier({ regionBase });

describe("frameBridge protocol", () => {
  it("mirrors lone-star's bridge version (2)", () => {
    expect(BRIDGE_VERSION).toBe(2);
  });
});

describe("targetOf — resolve a marked element", () => {
  it("resolves a style-only region (lowest precedence)", () => {
    document.body.innerHTML = `<h1 data-lse-style="hero_wordmark" id="h">SKEEN</h1>`;
    expect(targetOf(document.getElementById("h")!)).toEqual({
      kind: "style",
      key: "hero_wordmark",
    });
  });

  it("a content field wins over style on the same element", () => {
    document.body.innerHTML = `<h1 data-lse-field="artist_name" data-lse-style="hero_wordmark" id="h">SKEEN</h1>`;
    expect(targetOf(document.getElementById("h")!)).toEqual({
      kind: "field",
      key: "artist_name",
    });
  });

  it("resolves item (uuid survives colon split) and slot", () => {
    document.body.innerHTML = `<div data-lse-item="video:abc-123" id="i"></div><section data-lse-slot="videos" id="s"></section>`;
    expect(targetOf(document.getElementById("i")!)).toEqual({
      kind: "item",
      assetType: "video",
      id: "abc-123",
    });
    expect(targetOf(document.getElementById("s")!)).toEqual({
      kind: "slot",
      key: "videos",
    });
  });

  it("resolves a link-powered element to a link target", () => {
    document.body.innerHTML = `<a data-lse-link="usb" href="#" id="u">USB</a>`;
    expect(targetOf(document.getElementById("u")!)).toEqual({
      kind: "link",
      key: "usb",
    });
  });

  it("field/item/slot/style all win over link on the same element (link is lowest)", () => {
    document.body.innerHTML = `<a data-lse-link="usb" data-lse-style="hero_wordmark" href="#" id="a">x</a>`;
    // style precedes link in targetOf, so a link marker only resolves when it's alone.
    expect(targetOf(document.getElementById("a")!)).toEqual({
      kind: "style",
      key: "hero_wordmark",
    });
  });

  it("markedAncestor finds the nearest marker or null", () => {
    document.body.innerHTML = `<section data-lse-style="videos_section"><button id="b">x</button></section><p id="p">y</p>`;
    expect(
      markedAncestor(document.getElementById("b")!)!.getAttribute(
        "data-lse-style",
      ),
    ).toBe("videos_section");
    expect(markedAncestor(document.getElementById("p")!)).toBeNull();
  });
});

describe("optimistic DOM updates", () => {
  it("applyStyleToDom REPLACES a section region's class", () => {
    document.body.innerHTML = `<h1 data-lse-style="hero_wordmark" class="font-glitch">SKEEN</h1>`;
    applyStyleToDom(document, "hero_wordmark", "font-momo uppercase");
    expect(
      document
        .querySelector('[data-lse-style="hero_wordmark"]')!
        .getAttribute("class"),
    ).toBe("font-momo uppercase");
  });

  it("a per-item overlay lands as INLINE STYLE and re-applies against the base", () => {
    document.body.innerHTML = `<img data-lse-style="slot:polaroid_1_photo" class="h-full w-full object-cover">`;
    const el = () =>
      document.querySelector(
        '[data-lse-style="slot:polaroid_1_photo"]',
      ) as HTMLElement;
    applyStyleToDom(document, "slot:polaroid_1_photo", "scale-110");
    expect(el().getAttribute("class")).toBe("h-full w-full object-cover");
    expect(el().style.scale).toBe("1.1");
    // Dragging a slider re-sends the whole overlay; it must not compound.
    applyStyleToDom(document, "slot:polaroid_1_photo", "scale-125");
    expect(el().style.scale).toBe("1.25");
    applyStyleToDom(document, "slot:polaroid_1_photo", "");
    expect(el().getAttribute("class")).toBe("h-full w-full object-cover");
    expect(el().style.scale).toBe("");
  });

  it("repaints EVERY element sharing a region key, not just the first", () => {
    // The five polaroid captions share one region. querySelector took the first, so a
    // manager changing the font watched card 1 update while the other four sat unchanged
    // until a reload — the preview disagreeing with the page it is previewing.
    document.body.innerHTML = [1, 2, 3]
      .map(
        (n) =>
          `<p data-lse-style="polaroid_caption" class="font-alt" id="c${n}">c${n}</p>`,
      )
      .join("");
    // `text-lg` arrives fixed and lands fluid — resolveRegionStyle translates legacy
    // sizes now (see styles.test "legacy FIXED sizes render as their fluid twins"), and
    // the preview must agree with the render or the editor lies about the phone.
    applyStyleToDom(document, "polaroid_caption", "font-momo text-lg");
    for (const n of [1, 2, 3])
      expect(
        document.getElementById(`c${n}`)!.getAttribute("class"),
        `caption ${n}`,
      ).toBe("font-momo text-[clamp(0.95rem,2.6vw,1.125rem)]");
  });

  it("applies speed-[Nx] as playbackRate on a wrapper's video, and resets on clear", () => {
    document.body.innerHTML = `
      <div data-lse-style="slot:hero_landscape" class="absolute inset-0"><video id="clip"></video></div>
      <div data-lse-style="video:v1" class="rounded-md border-4"><iframe></iframe></div>`;
    const clip = document.getElementById("clip") as HTMLVideoElement;
    applyStyleToDom(document, "slot:hero_landscape", "speed-[1.5x] opacity-50");
    expect(clip.playbackRate).toBe(1.5);
    // Neither token lands as a class — both apply as properties.
    const wrapper = document.querySelector(
      '[data-lse-style="slot:hero_landscape"]',
    ) as HTMLElement;
    expect(wrapper.getAttribute("class")).toBe("absolute inset-0");
    expect(wrapper.style.opacity).toBe("0.5");
    applyStyleToDom(document, "slot:hero_landscape", "opacity-50");
    expect(clip.playbackRate).toBe(1);
    // A band embed region has no <video> to reach — the visual overlay still applies.
    applyStyleToDom(document, "video:v1", "scale-110");
    const band = document.querySelector(
      '[data-lse-style="video:v1"]',
    ) as HTMLElement;
    expect(band.getAttribute("class")).toBe("rounded-md border-4");
    expect(band.style.scale).toBe("1.1");
  });

  it("apply-image routes into applyFieldToDom: an <img> src swaps instantly", () => {
    document.body.innerHTML = `<img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">`;
    applyFieldToDom(document, "polaroid_1_photo", "https://x/new.jpg");
    expect(
      (
        document.querySelector(
          '[data-lse-field="polaroid_1_photo"]',
        ) as HTMLImageElement
      ).src,
    ).toBe("https://x/new.jpg");
  });

  it("writes a TEXT field as text even when the value looks like a URL", () => {
    // The value must actually trip looksLikeUrl or this proves nothing — it matches a
    // leading "/" (as well as http(s):// and data:image/), so a caption styled
    // "/ backstage /" is the realistic way a manager hits this. Without the manifest's
    // type, that caption is replaced by a broken <img>: the shape of a value cannot tell
    // you what a field IS.
    document.body.innerHTML = `<p data-lse-field="polaroid_1_caption">old</p>`;
    applyFieldToDom(document, "polaroid_1_caption", "/ backstage /", true);
    const el = document.querySelector('[data-lse-field="polaroid_1_caption"]')!;
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe("/ backstage /");
  });

  it("still swaps an IMAGE placeholder for an <img>, which is why the guess exists", () => {
    document.body.innerHTML = `<div data-lse-field="polaroid_1_photo">Add photo</div>`;
    applyFieldToDom(document, "polaroid_1_photo", "https://x/new.jpg");
    const el = document.querySelector('[data-lse-field="polaroid_1_photo"]')!;
    expect(el.tagName).toBe("IMG");
  });

  it("reads the TEXT field keys straight off the real manifest", () => {
    // Pinned to EDIT_LIST rather than a fixture: if the caption is ever re-typed as an
    // image, this and the DOM must move together or the bridge silently guesses again.
    const keys = textFieldKeys(EDIT_LIST);
    expect(keys.has("polaroid_1_caption")).toBe(true);
    expect(keys.has("polaroid_1_photo")).toBe(false);
  });

  it("survives a manifest that is missing, malformed, or has junk fields", () => {
    expect(textFieldKeys(undefined).size).toBe(0);
    expect(textFieldKeys({ fields: "nope" }).size).toBe(0);
    expect(textFieldKeys({ fields: [null, 7, { type: "text" }] }).size).toBe(0);
  });

  it("splits a WINDOWED item's overlay between window and item, like the server render", () => {
    document.body.innerHTML =
      `<div data-lse-style-window="slot:polaroid_1_photo" class="relative overflow-hidden">` +
      `<img data-lse-style="slot:polaroid_1_photo" class="h-full object-cover"></div>`;
    const win = () =>
      document.querySelector("[data-lse-style-window]") as HTMLElement;
    const img = () => document.querySelector("img")!;
    applyStyleToDom(
      document,
      "slot:polaroid_1_photo",
      "scale-110 rounded-full shadow-xl border-[#123abc]",
    );
    expect(img().getAttribute("class")).toBe("h-full object-cover");
    expect((img() as HTMLElement).style.scale).toBe("1.1");
    expect(win().getAttribute("class")).toBe("relative overflow-hidden");
    expect(win().style.borderRadius).toBe("9999px");
    expect(win().style.boxShadow).not.toBe("");
    expect(win().style.borderColor).toBe("rgb(18, 58, 188)");
    // Clearing the overlay restores BOTH elements to their own base.
    applyStyleToDom(document, "slot:polaroid_1_photo", "");
    expect((img() as HTMLElement).style.scale).toBe("");
    expect(win().style.borderRadius).toBe("");
    expect(win().style.borderColor).toBe("");
  });

  it("an arbitrary hex colour is applied inline, and cleared when it's removed", () => {
    document.body.innerHTML = `<img data-lse-style="slot:polaroid_1_photo" class="h-full">`;
    const el = () =>
      document.querySelector(
        '[data-lse-style="slot:polaroid_1_photo"]',
      ) as HTMLElement;
    applyStyleToDom(
      document,
      "slot:polaroid_1_photo",
      "border-[4px] border-[#123abc]",
    );
    expect(el().getAttribute("class")).toBe("h-full"); // the width is inline too now
    expect(el().style.borderWidth).toBe("4px");
    expect(el().style.borderColor).toBe("rgb(18, 58, 188)");
    applyStyleToDom(document, "slot:polaroid_1_photo", "border-[4px]");
    expect(el().style.borderColor).toBe("");
  });

  it("applyFieldToDom sets text / image src, and both no-op when absent", () => {
    document.body.innerHTML = `<h2 data-lse-field="shows_heading">Shows</h2><img data-lse-field="hero_image" src="old.jpg" />`;
    applyFieldToDom(document, "shows_heading", "Concerts");
    expect(
      document.querySelector('[data-lse-field="shows_heading"]')!.textContent,
    ).toBe("Concerts");
    applyFieldToDom(document, "hero_image", "new.jpg");
    expect(
      document
        .querySelector('[data-lse-field="hero_image"]')!
        .getAttribute("src"),
    ).toBe("new.jpg");
    expect(() => applyStyleToDom(document, "missing", "x")).not.toThrow();
    expect(() => applyFieldToDom(document, "missing", "x")).not.toThrow();
  });

  it("swaps an EMPTY slot's placeholder for a real <img> on the first image drop", () => {
    // About renders an unfilled polaroid slot as a dashed placeholder <div>, and that
    // placeholder is exactly what a manager drops the first photo onto. Writing the URL
    // as textContent there would print the URL instead of showing the photo.
    document.body.innerHTML = `<div data-lse-field="polaroid_1_photo" class="dashed">Add photo</div>`;
    applyFieldToDom(document, "polaroid_1_photo", "https://cdn/p.jpg");
    const el = document.querySelector('[data-lse-field="polaroid_1_photo"]')!;
    expect(el.tagName).toBe("IMG");
    expect(el.getAttribute("src")).toBe("https://cdn/p.jpg");
    // Keeps the marker and classes, so a second edit behaves like any image field.
    expect(el.className).toBe("dashed");
    applyFieldToDom(document, "polaroid_1_photo", "https://cdn/q.jpg");
    expect(
      document
        .querySelector('[data-lse-field="polaroid_1_photo"]')!
        .getAttribute("src"),
    ).toBe("https://cdn/q.jpg");
  });

  it("still writes plain text into a non-img field when the value isn't a URL", () => {
    document.body.innerHTML = `<h2 data-lse-field="shows_heading">Shows</h2>`;
    applyFieldToDom(document, "shows_heading", "Concerts");
    const el = document.querySelector('[data-lse-field="shows_heading"]')!;
    expect(el.tagName).toBe("H2");
    expect(el.textContent).toBe("Concerts");
  });

  it("applyLinkToDom sets the anchor's href, and no-ops when absent", () => {
    document.body.innerHTML = `<a data-lse-link="usb" href="#">USB</a>`;
    applyLinkToDom(document, "usb", "https://open.spotify.com/playlist/usb");
    expect(
      document.querySelector('[data-lse-link="usb"]')!.getAttribute("href"),
    ).toBe("https://open.spotify.com/playlist/usb");
    expect(() => applyLinkToDom(document, "missing", "x")).not.toThrow();
  });
});

describe("highlight — the editor outlines a region in the frame", () => {
  it("builds the marker selector for each target kind (inverse of targetOf)", () => {
    expect(highlightSelector({ kind: "field", key: "hero_image" })).toBe(
      '[data-lse-field="hero_image"]',
    );
    expect(
      highlightSelector({ kind: "item", assetType: "image", id: "g1" }),
    ).toBe('[data-lse-item="image:g1"]');
    expect(highlightSelector({ kind: "slot", key: "shows" })).toBe(
      '[data-lse-slot="shows"]',
    );
  });

  it("marks the matched element, moving the highlight so only one holds it", () => {
    document.body.innerHTML = `
      <img data-lse-field="polaroid_1_photo" src="p.jpg" />
      <div data-lse-item="image:g1"></div>`;
    const first = applyHighlightToDom(document, {
      kind: "field",
      key: "polaroid_1_photo",
    });
    expect(first!.hasAttribute("data-lse-highlight")).toBe(true);
    applyHighlightToDom(document, {
      kind: "item",
      assetType: "image",
      id: "g1",
    });
    expect(document.querySelectorAll("[data-lse-highlight]")).toHaveLength(1);
    expect(
      document
        .querySelector('[data-lse-item="image:g1"]')!
        .hasAttribute("data-lse-highlight"),
    ).toBe(true);
  });

  it("returns null and marks nothing when the region is absent; clear removes the mark", () => {
    document.body.innerHTML = `<img data-lse-field="hero_image" data-lse-highlight src="h.jpg" />`;
    expect(
      applyHighlightToDom(document, { kind: "field", key: "missing" }),
    ).toBeNull();
    clearHighlightFromDom(document);
    expect(document.querySelector("[data-lse-highlight]")).toBeNull();
  });
});

describe("mountFrameBridge — the ready handshake", () => {
  /** A stand-in for the editor window: records every postMessage it receives. */
  function fakeEditor() {
    const posts: { msg: Record<string, unknown>; origin: string }[] = [];
    return {
      posts,
      target: {
        postMessage: (msg: Record<string, unknown>, origin: string) =>
          posts.push({ msg, origin }),
      } as unknown as Window,
    };
  }

  it("CRITICAL: re-announces after the content renders, so DOM-derived fields ship", () => {
    // The race, and it silently broke every wrapped string on the site.
    //
    // /edit renders NOTHING until the editor sends init-data — before that it is a
    // "Waiting for the editor…" placeholder. But the first `ready` fires on mount, so the
    // manifest is built by scanning an EMPTY document: withDomTextFields finds no
    // <Text> elements and announces only the statically declared fields.
    //
    // Then the editor replies, stopAnnouncing() runs, init-data arrives, SiteBody finally
    // renders the wrapped strings — and nothing ever announces again. The editor keeps
    // the empty-DOM manifest for the life of the session.
    //
    // That is exactly the split Sam reported: the polaroid captions worked (declared in
    // EDIT_LIST.fields, present with or without a DOM) while the tour heading, the contact
    // button, the footer line and the popup copy did not (derived from the DOM, and the
    // DOM was empty when anyone looked).
    const editor = fakeEditor();
    // The manifest a real frame builds: whatever is on the page RIGHT NOW.
    let rendered = false;
    const editList = () => ({
      ...EDIT_LIST,
      fields: rendered
        ? [
            ...EDIT_LIST.fields,
            {
              key: "tour_heading",
              label: "Tour heading",
              type: "text" as const,
            },
          ]
        : EDIT_LIST.fields,
    });
    let announce = () => {};
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {
        // What SiteBody does: the wrapped strings enter the DOM only now.
        rendered = true;
      },
      editList,
      target: editor.target,
      onMounted: (h) => {
        announce = h.announce;
      },
    });

    const keysOf = (p: { msg: Record<string, unknown> }) =>
      ((p.msg.manifest as typeof EDIT_LIST).fields ?? []).map((f) => f.key);
    const readies = () => editor.posts.filter((p) => p.msg.type === "ready");

    // The first announce cannot see the heading — the page has not rendered.
    expect(keysOf(readies()[0])).not.toContain("tour_heading");

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:3000",
        data: {
          v: BRIDGE_VERSION,
          source: "lse-editor",
          type: "init-data",
          site: {} as never,
        },
      }),
    );

    // The frame must announce AGAIN once its content exists, or the editor is stuck with
    // a manifest describing a blank page.
    announce();
    expect(keysOf(readies().at(-1)!)).toContain("tour_heading");
    teardown();
  });

  it("announces ready with the FULL edit-list, to the editor origin only", () => {
    // Nothing covered this before, and it is the single point of failure for the whole
    // editor: no ready → no manifest → the panel silently shows "0 regions" and every
    // component the site declares disappears, with no error anywhere.
    const editor = fakeEditor();
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {},
      editList: EDIT_LIST,
      target: editor.target,
    });
    const ready = editor.posts.find((p) => p.msg.type === "ready");
    expect(ready).toBeTruthy();
    expect(ready!.origin).toBe("http://localhost:3000"); // never "*"
    expect(ready!.msg.v).toBe(BRIDGE_VERSION);
    expect(ready!.msg.source).toBe("lse-frame");
    const manifest = ready!.msg.manifest as typeof EDIT_LIST;
    expect(manifest.styles.map((s) => s.key)).toEqual(
      EDIT_LIST.styles.map((r) => r.key),
    );
    expect(manifest.styles.length).toBeGreaterThan(0);
    expect(manifest.components?.length).toBeGreaterThan(0);
    // The palette the editor paints its swatches from.
    expect(manifest.styleOptions.textColors.every((o) => o.hex)).toBe(true);
    teardown();
  });

  it("KEEPS announcing until the editor answers, then stops", () => {
    // The bug this pins: announced once, a ready posted before the editor attached its
    // listener was lost with no error, and the panel silently showed "0 regions".
    vi.useFakeTimers();
    try {
      const editor = fakeEditor();
      const teardown = mountFrameBridge({
        editorOrigin: "http://localhost:3000",
        onInitData: () => {},
        editList: EDIT_LIST,
        target: editor.target,
      });
      expect(editor.posts.filter((p) => p.msg.type === "ready")).toHaveLength(
        1,
      );
      vi.advanceTimersByTime(READY_RETRY_MS * 3);
      expect(
        editor.posts.filter((p) => p.msg.type === "ready").length,
      ).toBeGreaterThan(1);

      // The editor speaks up: announcing stops.
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            v: BRIDGE_VERSION,
            source: EDITOR_SOURCE,
            type: "clear-highlight",
          },
        }),
      );
      const settled = editor.posts.filter((p) => p.msg.type === "ready").length;
      vi.advanceTimersByTime(READY_RETRY_MS * 10);
      expect(editor.posts.filter((p) => p.msg.type === "ready")).toHaveLength(
        settled,
      );
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a real apply-field for a TEXT key without swapping it for an image", () => {
    // The wiring, not the halves. applyFieldToDom and textFieldKeys are each covered
    // above; what this pins is that the message handler actually consults the manifest
    // before writing. Break that link and both unit tests still pass while a manager's
    // caption turns into a broken <img> in the live preview.
    document.body.innerHTML = `<p data-lse-field="polaroid_1_caption">old</p>`;
    const editor = fakeEditor();
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {},
      editList: EDIT_LIST,
      target: editor.target,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:3000",
        data: {
          v: BRIDGE_VERSION,
          source: EDITOR_SOURCE,
          type: "apply-field",
          key: "polaroid_1_caption",
          value: "/ backstage /",
        },
      }),
    );
    const el = document.querySelector('[data-lse-field="polaroid_1_caption"]')!;
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe("/ backstage /");
    teardown();
  });

  it("answers a late `hello` with a fresh ready — the recovery a one-way handshake lacked", () => {
    vi.useFakeTimers();
    try {
      const editor = fakeEditor();
      const teardown = mountFrameBridge({
        editorOrigin: "http://localhost:3000",
        onInitData: () => {},
        editList: EDIT_LIST,
        target: editor.target,
      });
      // Let every announcement be spent into the void, as when the editor mounts late.
      vi.advanceTimersByTime(READY_RETRY_MS * (READY_RETRIES + 5));
      const spent = editor.posts.filter((p) => p.msg.type === "ready").length;

      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, type: "hello" },
        }),
      );
      const readys = editor.posts.filter((p) => p.msg.type === "ready");
      expect(readys.length).toBe(spent + 1);
      // And it carries the manifest, not a bare ping.
      expect(
        (readys.at(-1)!.msg.manifest as typeof EDIT_LIST).styles.length,
      ).toBeGreaterThan(0);
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports handshake status so the edit shell can show it", () => {
    vi.useFakeTimers();
    try {
      const editor = fakeEditor();
      const seen: { announces: number; connected: boolean }[] = [];
      const teardown = mountFrameBridge({
        editorOrigin: "http://localhost:3000",
        onInitData: () => {},
        editList: EDIT_LIST,
        target: editor.target,
        onStatus: (s) => seen.push(s),
      });
      expect(seen[0]).toEqual({ announces: 1, connected: false });
      vi.advanceTimersByTime(READY_RETRY_MS * 2);
      expect(seen.at(-1)!.announces).toBeGreaterThan(1);
      expect(seen.at(-1)!.connected).toBe(false);

      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            v: BRIDGE_VERSION,
            source: EDITOR_SOURCE,
            type: "clear-highlight",
          },
        }),
      );
      expect(seen.at(-1)!.connected).toBe(true);
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up rather than announcing forever with no editor there", () => {
    vi.useFakeTimers();
    try {
      const editor = fakeEditor();
      const teardown = mountFrameBridge({
        editorOrigin: "http://localhost:3000",
        onInitData: () => {},
        editList: EDIT_LIST,
        target: editor.target,
      });
      vi.advanceTimersByTime(READY_RETRY_MS * (READY_RETRIES + 50));
      expect(
        editor.posts.filter((p) => p.msg.type === "ready").length,
      ).toBeLessThanOrEqual(READY_RETRIES);
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("editor → frame message dispatch", () => {
  /** Mount the bridge and send one editor message through the real listener. */
  function send(msg: Record<string, unknown>) {
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {},
      editList: EDIT_LIST,
      target: { postMessage: () => {} } as unknown as Window,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:3000",
        data: { v: BRIDGE_VERSION, source: EDITOR_SOURCE, ...msg },
      }),
    );
    teardown();
  }

  it("apply-image repaints an image region — the MESSAGE, not just the helper", () => {
    // The old test called applyFieldToDom directly, so the routing branch (and its `url`
    // field name, which every other apply-* spells `value`/`className`) had no coverage:
    // deleting the branch kept the suite green.
    document.body.innerHTML = `<img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">`;
    send({
      type: "apply-image",
      key: "polaroid_1_photo",
      url: "https://x/new.jpg",
    });
    expect(document.querySelector("img")!.src).toBe("https://x/new.jpg");
  });

  it("an EMPTY url is a no-op, never a blanked element", () => {
    // apply-image used to share applyFieldToDom, which writes textContent for anything
    // that doesn't look like a URL — so clearing a slot wiped the element's markup. An
    // image url landing as text is worse than no repaint, and what an empty slot should
    // look like is the template's call, so clearing is left to the init-data refresh.
    // Shape matters here, and the first version of this test got it wrong: against a
    // placeholder DIV nothing happens either way, so it passed with the guard deleted.
    // The guard bites where there IS an image to blank.
    document.body.innerHTML =
      `<img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">` +
      `<figure data-lse-field="polaroid_2_photo"><img src="https://x/old2.jpg"></figure>` +
      `<div data-lse-field="polaroid_3_photo">Add photo</div>`;
    for (const key of [
      "polaroid_1_photo",
      "polaroid_2_photo",
      "polaroid_3_photo",
    ])
      send({ type: "apply-image", key, url: "" });
    expect(document.querySelectorAll("img")[0].src).toBe("https://x/old.jpg");
    expect(document.querySelectorAll("img")[1].src).toBe("https://x/old2.jpg");
    expect(document.querySelector("div")!.textContent).toBe("Add photo");
  });

  it("repaints an <img> NESTED in a marked wrapper, keeping the wrapper", () => {
    // The marked element is not always the image itself. Replacing the wrapper here
    // would throw away whatever else it holds.
    document.body.innerHTML =
      `<figure data-lse-field="polaroid_1_photo" class="card">` +
      `<img src="https://x/old.jpg"><figcaption>cap</figcaption></figure>`;
    send({
      type: "apply-image",
      key: "polaroid_1_photo",
      url: "https://x/new.jpg",
    });
    expect(document.querySelector("img")!.src).toBe("https://x/new.jpg");
    expect(document.querySelector("figure")).not.toBeNull();
    expect(document.querySelector("figcaption")!.textContent).toBe("cap");
  });

  it("still swaps an empty slot's PLACEHOLDER for a real image", () => {
    // Skeen's own extra over lone-star: an unfilled polaroid renders a dashed div, and
    // that div is exactly what a manager drops the first photo onto.
    document.body.innerHTML = `<div data-lse-field="polaroid_1_photo" data-lse-style="slot:polaroid_1_photo">Add photo</div>`;
    send({
      type: "apply-image",
      key: "polaroid_1_photo",
      url: "https://x/new.jpg",
    });
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://x/new.jpg");
    expect(img.getAttribute("data-lse-style")).toBe("slot:polaroid_1_photo");
  });

  it("a malformed payload no-ops instead of throwing out of the listener", () => {
    // `type` guarantees nothing about SHAPE — the editor is a separate deploy. An
    // undefined url reaching looksLikeUrl(value.trim()) used to throw and drop the
    // message with only a console error.
    document.body.innerHTML = `<img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">`;
    expect(() =>
      send({ type: "apply-image", key: "polaroid_1_photo" }),
    ).not.toThrow();
    expect(() =>
      send({ type: "apply-style", key: "hero_video" }),
    ).not.toThrow();
    expect(() => send({ type: "apply-link", key: "usb" })).not.toThrow();
    expect(document.querySelector("img")!.src).toBe("https://x/old.jpg");
  });

  it("accepts an OLDER sender, so a version bump can't kill the handshake", () => {
    document.body.innerHTML = `<img data-lse-field="polaroid_1_photo" src="https://x/old.jpg">`;
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {},
      editList: EDIT_LIST,
      target: { postMessage: () => {} } as unknown as Window,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:3000",
        data: {
          v: BRIDGE_VERSION - 1,
          source: EDITOR_SOURCE,
          type: "apply-image",
          key: "polaroid_1_photo",
          url: "https://x/v1.jpg",
        },
      }),
    );
    expect(document.querySelector("img")!.src).toBe("https://x/v1.jpg");
    teardown();
  });
});

describe("the two regions that share the hero clip", () => {
  /** The real hero shape: a slot-keyed wrapper around a section-keyed <video>. */
  function heroDom() {
    document.body.innerHTML =
      `<div data-lse-style="slot:hero_landscape" class="absolute inset-0">` +
      `<video data-lse-style="hero_video" class="absolute inset-0 h-full w-full object-cover"></video></div>`;
    return document.querySelector("video") as HTMLVideoElement;
  }

  it("a section restyle does not wipe the speed the slot owns", () => {
    const clip = heroDom();
    applyStyleToDom(document, "slot:hero_landscape", "speed-[1.5x]");
    expect(clip.playbackRate).toBe(1.5);
    // Only the region that CARRIES speed may reset it. This used to slam it to 1x.
    applyStyleToDom(document, "hero_video", "absolute inset-0 object-contain");
    expect(clip.playbackRate).toBe(1.5);
    // The slot clearing its own token still resets, which is the point of the reset.
    applyStyleToDom(document, "slot:hero_landscape", "");
    expect(clip.playbackRate).toBe(1);
  });

  it("a style RESET restores the declared base, not the live class attribute", () => {
    // React appends `opacity-0` to the clip until canplay. Snapshotting that as the base
    // meant an empty override — the editor's own reset — hoisted it to inline opacity 0,
    // which React can never take back. The clip went invisible for the whole session.
    document.body.innerHTML = `<video data-lse-style="hero_video" class="absolute inset-0 h-full w-full object-cover opacity-0"></video>`;
    const clip = document.querySelector("video") as HTMLVideoElement;
    // The BOUND applier: bare applyStyleToDom carries no registry by design (the
    // 2026-08-07 deepening) — a caller that wants declared-base snapshots constructs
    // the binding, exactly as mountFrameBridge does from its option.
    boundApplier.applyStyleToDom(document, "hero_video", "");
    expect(clip.style.opacity).toBe("");
    // The DECLARED base, read from STYLE_REGIONS rather than restated — it gained a
    // mobile zoom on 2026-08-06 and a literal here would have to be edited every time the
    // hero is retuned, which is how a test stops testing and starts describing.
    expect(clip.getAttribute("class")).toBe(regionBase("hero_video"));
  });
});

describe("the placeholder → <img> swap", () => {
  it("carries EVERY marker across, so the new photo is still styleable", () => {
    // An empty polaroid renders a placeholder div carrying both the field marker and the
    // item's style marker. Dropping the style one meant the first photo a manager added
    // silently lost size/border/corner/shadow for the rest of the session.
    document.body.innerHTML = `<div data-lse-field="polaroid_1_photo" data-lse-style="slot:polaroid_1_photo" class="h-full w-full object-cover border-dashed">Add photo</div>`;
    applyFieldToDom(document, "polaroid_1_photo", "https://x/new.jpg");
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("data-lse-style")).toBe("slot:polaroid_1_photo");
    expect(img.getAttribute("data-lse-field")).toBe("polaroid_1_photo");
    // ...and the style controls now reach it.
    applyStyleToDom(document, "slot:polaroid_1_photo", "scale-110");
    expect(img.style.scale).toBe("1.1");
  });
});

describe("region keys are not a closed vocabulary", () => {
  it("a key carrying a quote is escaped, not injected, and never throws", () => {
    // Keys come from lone-star's DB (`image:<uuid>`, `slot:<role>`). Unescaped, a quote
    // makes querySelector throw SyntaxError straight out of the message listener.
    document.body.innerHTML = `<img data-lse-style="slot:safe" class="h-full">`;
    expect(() =>
      applyStyleToDom(document, 'slot:a"] , [data-lse-style', "scale-110"),
    ).not.toThrow();
    expect((document.querySelector("img") as HTMLElement).style.scale).toBe("");
    expect(() =>
      highlightSelector({ kind: "style", key: 'a"b' }),
    ).not.toThrow();
  });
});

describe("swapForImage — the placeholder's classes are not always the image's", () => {
  // Found in review, 2026-08-06. Copying the placeholder's className is right when the
  // placeholder is shaped like the image it stands in for — the polaroid drop targets are,
  // deliberately. It is wrong when the placeholder IS the real content: the hero
  // wordmark's stand-in is the word SKEEN, so its classes are an 11rem glitching display
  // face, and the first logo dropped rendered at intrinsic size with the animation running.
  const drop = (el: Element, key: string, url: string) => {
    applyFieldToDom(el.ownerDocument, key, url, false);
    return el.ownerDocument.querySelector(`img[data-lse-field="${key}"]`)!;
  };

  it("CRITICAL: prefers data-lse-img-class over the placeholder's own classes", () => {
    document.body.innerHTML = `<h1 data-lse-field="hero_wordmark_image"
      data-lse-style="hero_wordmark"
      data-lse-img-class="max-h-[45svh] w-auto object-contain"
      class="fx-glitch-mono text-[clamp(4rem,18vw,11rem)]">Skeen</h1>`;
    const img = drop(
      document.querySelector("h1")!,
      "hero_wordmark_image",
      "https://cdn.test/logo.png",
    );
    expect(img.className).toBe("max-h-[45svh] w-auto object-contain");
    expect(img.className).not.toContain("fx-glitch-mono");
    // The attribute NAMES the classes; it is not one of them, so it does not travel.
    expect(img.hasAttribute("data-lse-img-class")).toBe(false);
    // Every other marker still does — losing data-lse-style is what left the first photo
    // a manager added unstyleable for the rest of the session.
    expect(img.getAttribute("data-lse-style")).toBe("hero_wordmark");
  });

  it("falls back to copying className, so existing drop targets are unchanged", () => {
    // The polaroid placeholders carry no data-lse-img-class and must keep the old
    // behaviour exactly — their classes ARE the image's.
    document.body.innerHTML = `<div data-lse-field="polaroid_1_photo"
      data-lse-style="slot:polaroid_1_photo"
      class="h-full w-full object-cover">Add photo</div>`;
    const img = drop(
      document.querySelector("div")!,
      "polaroid_1_photo",
      "https://cdn.test/p.jpg",
    );
    expect(img.className).toBe("h-full w-full object-cover");
    expect(img.getAttribute("data-lse-style")).toBe("slot:polaroid_1_photo");
  });

  it("takes the placeholder's words as alt text rather than leaving it empty", () => {
    // `alt=""` marks an image decorative. A freshly dropped wordmark is the artist's name
    // and a polaroid is a photo of them — neither is decoration, and both were invisible
    // to a screen reader until the page reloaded.
    document.body.innerHTML = `<h1 data-lse-field="hero_wordmark_image">Skeen</h1>`;
    expect(
      drop(
        document.querySelector("h1")!,
        "hero_wordmark_image",
        "https://cdn.test/logo.png",
      ).getAttribute("alt"),
    ).toBe("Skeen");
  });
});

describe("highlight marks EVERY match (SITE_BRIDGE_PLAN.md P8 — the port's one sanctioned behavior change)", () => {
  it("CRITICAL: a repeated marker (socials render in hero AND footer) outlines both", () => {
    // skeen's original highlighted querySelector's first match — an accident, not a
    // decision. applyStyleToDom already learned better from the five polaroid captions
    // sharing one region; the highlight now follows the same rule. The first match is
    // still the return value: it is the scroll target.
    document.body.innerHTML = `
      <a data-lse-item="link:instagram" id="hero-ig">hero</a>
      <a data-lse-item="link:instagram" id="footer-ig">footer</a>`;
    const first = applyHighlightToDom(document, { kind: "item", assetType: "link", id: "instagram" });
    expect(first?.id).toBe("hero-ig");
    expect(document.getElementById("hero-ig")!.hasAttribute("data-lse-highlight")).toBe(true);
    expect(document.getElementById("footer-ig")!.hasAttribute("data-lse-highlight")).toBe(true);
    // …and clearing drops them ALL, or a second selection leaves a stale outline behind.
    clearHighlightFromDom(document);
    expect(document.querySelectorAll("[data-lse-highlight]").length).toBe(0);
  });
});

describe("mountFrameBridge({ regionBase }) — the documented injection path", () => {
  it("CRITICAL: the option binds the lookup before any message can apply a style", () => {
    // The review of 2026-08-07 found the docblock promising this option while only the
    // bare setter existed — and the setter is ORDER-SENSITIVE: an apply-style landing
    // before it caches the wrong base per element for the session (the hero opacity-0
    // incident, made intermittent). This proves the option alone is enough.
    document.body.innerHTML = `<section data-lse-style="work_section" class="relative z-0 opacity-0" id="s"></section>`;
    // Minimal editor stand-in: the shared fakeEditor helper is scoped to its own
    // describe; all this test needs is a postMessage sink.
    const editor = { target: { postMessage: () => {} } as unknown as Window };
    const teardown = mountFrameBridge({
      editorOrigin: "http://localhost:3000",
      onInitData: () => {},
      editList: EDIT_LIST,
      target: editor.target,
      regionBase, // the option under test — no setRegionBaseLookup call anywhere here
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://localhost:3000",
        data: { v: BRIDGE_VERSION, source: "lse-editor", type: "apply-style", key: "work_section", className: "" },
      }),
    );
    // A reset restores the DECLARED base — not the live class list with its transient
    // opacity-0 — which is only possible if the option installed the lookup in time.
    expect(document.getElementById("s")!.getAttribute("class")).toBe("relative z-0");
    teardown();
  });
});

describe('browse mode hands the site back its own clicks', () => {
  it('CRITICAL: in browse, a click on a marked element is NOT intercepted', () => {
    // Sam, 2026-08-10, on the tabbed throwaway: "I cant click through the site on the
    // editor. It just pulls up the tab button in the left panel." Edit mode swallows
    // every click on a marked element — capture phase, preventDefault,
    // stopImmediatePropagation — which is right for selecting and fatal for a site with
    // navigation.
    const posted: unknown[] = []
    const target = { postMessage: (m: unknown) => posted.push(m) } as unknown as Window
    const stop = mountFrameBridge({ editorOrigin: 'https://editor.test', onInitData: () => {}, target })

    const el = document.createElement('button')
    el.setAttribute(FIELD_ATTR, 'hero')
    document.body.appendChild(el)

    editorSays({ type: 'set-mode', mode: 'browse' })
    posted.length = 0

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(ev)

    expect(ev.defaultPrevented, 'browse must not preventDefault').toBe(false)
    expect(posted.filter((m) => (m as { type?: string }).type === 'select')).toHaveLength(0)
    stop()
    el.remove()
  })

  it('CRITICAL: edit mode still intercepts — the negative above needs its opposite', () => {
    const posted: unknown[] = []
    const target = { postMessage: (m: unknown) => posted.push(m) } as unknown as Window
    const stop = mountFrameBridge({ editorOrigin: 'https://editor.test', onInitData: () => {}, target })

    const el = document.createElement('button')
    el.setAttribute(FIELD_ATTR, 'hero')
    document.body.appendChild(el)

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(posted.filter((m) => (m as { type?: string }).type === 'select')).toHaveLength(1)
    stop()
    el.remove()
  })

  it('switching back to edit restores interception', () => {
    // A one-way door would strand the manager in a site they can no longer edit.
    const posted: unknown[] = []
    const target = { postMessage: (m: unknown) => posted.push(m) } as unknown as Window
    const stop = mountFrameBridge({ editorOrigin: 'https://editor.test', onInitData: () => {}, target })

    const el = document.createElement('button')
    el.setAttribute(FIELD_ATTR, 'hero')
    document.body.appendChild(el)

    editorSays({ type: 'set-mode', mode: 'browse' })
    editorSays({ type: 'set-mode', mode: 'edit' })
    posted.length = 0

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(posted.filter((m) => (m as { type?: string }).type === 'select')).toHaveLength(1)
    stop()
    el.remove()
  })

  it('entering browse drops the highlight — a ring you cannot clear is worse than none', () => {
    const target = { postMessage: () => {} } as unknown as Window
    const stop = mountFrameBridge({ editorOrigin: 'https://editor.test', onInitData: () => {}, target })

    const el = document.createElement('div')
    el.setAttribute(FIELD_ATTR, 'hero')
    document.body.appendChild(el)

    editorSays({ type: 'highlight', target: { kind: 'field', key: 'hero' } })
    expect(el.hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    editorSays({ type: 'set-mode', mode: 'browse' })
    expect(el.hasAttribute(HIGHLIGHT_ATTR)).toBe(false)
    stop()
    el.remove()
  })
})

describe('reveal — highlighting a region that is not on the page', () => {
  it('CRITICAL: a missing region asks the SITE to show it, then highlights', async () => {
    // Panel → preview selection silently did nothing whenever the target sat behind a
    // closed tab (throwaway #2, 2026-08-10). The editor cannot know it is hidden; the
    // site cannot know the manager clicked its row.
    const target = { postMessage: () => {} } as unknown as Window
    let revealed: unknown = null
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      target,
      onReveal: (t) => {
        revealed = t
        // ASYNC on purpose: a React site re-renders after its state change, so the
        // element lands on a later tick. The synchronous case is covered below — it
        // needed its own code path, because an observer only sees FUTURE mutations.
        setTimeout(() => {
          const el = document.createElement('div')
          el.id = 'late'
          el.setAttribute(FIELD_ATTR, 'buried')
          document.body.appendChild(el)
        }, 0)
      },
    })

    editorSays({ type: 'highlight', target: { kind: 'field', key: 'buried' } })
    expect(revealed).toEqual({ kind: 'field', key: 'buried' })

    // The frame watches for it and highlights once it lands.
    await vi.waitFor(() => {
      expect(document.getElementById('late')?.hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    })
    stop()
    document.getElementById('late')?.remove()
  })

  it('CRITICAL: a SYNCHRONOUS reveal is highlighted too', async () => {
    // The first cut observed before re-checking, so a site that revealed synchronously
    // waited out the whole timeout with the element sitting right there.
    const target = { postMessage: () => {} } as unknown as Window
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      target,
      onReveal: () => {
        const el = document.createElement('div')
        el.id = 'sync'
        el.setAttribute(FIELD_ATTR, 'instant')
        document.body.appendChild(el)
      },
    })
    editorSays({ type: 'highlight', target: { kind: 'field', key: 'instant' } })
    expect(document.getElementById('sync')?.hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    stop()
    document.getElementById('sync')?.remove()
  })

  it('CRITICAL: a region already ON the page is highlighted WITHOUT asking', () => {
    // The reveal must be the exception. Asking every time would make a site re-open tabs
    // under a manager who is already looking at the thing they clicked.
    const target = { postMessage: () => {} } as unknown as Window
    let asked = 0
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      target,
      onReveal: () => { asked += 1 },
    })

    const el = document.createElement('div')
    el.setAttribute(FIELD_ATTR, 'present')
    document.body.appendChild(el)

    editorSays({ type: 'highlight', target: { kind: 'field', key: 'present' } })
    expect(el.hasAttribute(HIGHLIGHT_ATTR)).toBe(true)
    expect(asked).toBe(0)
    stop()
    el.remove()
  })

  it('a site that implements no reveal behaves exactly as before', () => {
    // The capability is opt-in. Without it a missing target is dropped silently, which
    // is today's behaviour and must not become a crash.
    const target = { postMessage: () => {} } as unknown as Window
    const stop = mountFrameBridge({ editorOrigin: 'https://editor.test', onInitData: () => {}, target })
    expect(() => editorSays({ type: 'highlight', target: { kind: 'field', key: 'nowhere' } })).not.toThrow()
    stop()
  })

  it('gives up quietly when the region never arrives', async () => {
    // A site may legitimately have no such region. Waiting forever would leave an
    // observer attached to the page for the rest of the session.
    vi.useFakeTimers()
    try {
      const target = { postMessage: () => {} } as unknown as Window
      const stop = mountFrameBridge({
        editorOrigin: 'https://editor.test',
        onInitData: () => {},
        target,
        onReveal: () => {},
      })
      editorSays({ type: 'highlight', target: { kind: 'field', key: 'never' } })
      vi.advanceTimersByTime(REVEAL_TIMEOUT_MS + 100)
      // Nothing marked, nothing thrown, and the observer is disconnected.
      expect(document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).length).toBe(0)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a pending reveal belongs to the LATEST selection only', () => {
  it('CRITICAL: a newer highlight cancels an older wait — the ring never travels back', async () => {
    // 2026-08-10 review. Waits used to accumulate: select hidden A, then select mounted
    // B — when A's tab content later mounted for ANY reason, A's observer fired and
    // applyHighlightToDom(A) cleared B's ring. The manager's current selection lost its
    // outline to one they had abandoned.
    const target = { postMessage: () => {} } as unknown as Window
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      target,
      onReveal: () => {}, // reveals nothing yet — A stays hidden
    })

    const b = document.createElement('div')
    b.setAttribute(FIELD_ATTR, 'b-present')
    document.body.appendChild(b)

    editorSays({ type: 'highlight', target: { kind: 'field', key: 'a-hidden' } }) // wait starts
    editorSays({ type: 'highlight', target: { kind: 'field', key: 'b-present' } }) // supersedes it
    expect(b.hasAttribute(HIGHLIGHT_ATTR)).toBe(true)

    // A's element arrives late. The cancelled wait must NOT steal the ring.
    const a = document.createElement('div')
    a.id = 'late-a'
    a.setAttribute(FIELD_ATTR, 'a-hidden')
    document.body.appendChild(a)
    await new Promise((r) => setTimeout(r, 50)) // let any observer fire
    expect(b.hasAttribute(HIGHLIGHT_ATTR), 'B keeps its ring').toBe(true)
    expect(a.hasAttribute(HIGHLIGHT_ATTR), 'A must not ring').toBe(false)

    stop()
    a.remove()
    b.remove()
  })

  it('CRITICAL: clear-highlight abandons the wait too', async () => {
    const target = { postMessage: () => {} } as unknown as Window
    const stop = mountFrameBridge({
      editorOrigin: 'https://editor.test',
      onInitData: () => {},
      target,
      onReveal: () => {},
    })
    editorSays({ type: 'highlight', target: { kind: 'field', key: 'gone' } })
    editorSays({ type: 'clear-highlight' })

    const el = document.createElement('div')
    el.id = 'late-gone'
    el.setAttribute(FIELD_ATTR, 'gone')
    document.body.appendChild(el)
    await new Promise((r) => setTimeout(r, 50))
    expect(el.hasAttribute(HIGHLIGHT_ATTR)).toBe(false)
    stop()
    el.remove()
  })
})
