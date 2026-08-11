/**
 * Pause / resume every playing video on the page (Sam, 2026-08-11: a toolbar button
 * that "pauses all active videos playing and then resumes").
 *
 * Two kinds of video, two levers:
 *  • <video> elements — paused directly. Only the ones WE paused are resumed
 *    (marked with an attribute), so a clip the site or the fan had paused
 *    themselves doesn't spring back to life on resume.
 *  • YouTube/Vimeo iframes — best-effort postMessage commands. They only land when
 *    the embed enabled its JS API (YouTube: `enablejsapi=1`); without it the frame
 *    ignores the message, harmlessly.
 */

const PAUSED_BY_US = "data-lse-paused";

export function setVideosPlaying(doc: Document, playing: boolean): void {
  doc.querySelectorAll<HTMLVideoElement>("video").forEach((v) => {
    if (!playing) {
      if (v.paused) return;
      v.setAttribute(PAUSED_BY_US, "");
      v.pause();
    } else if (v.hasAttribute(PAUSED_BY_US)) {
      v.removeAttribute(PAUSED_BY_US);
      // play() returns a promise that rejects on autoplay policy — swallow it: the
      // manager clicked, so gestures exist, but a race must not surface as an error.
      void v.play()?.catch?.(() => {});
    }
  });
  doc.querySelectorAll<HTMLIFrameElement>("iframe").forEach((f) => {
    const w = f.contentWindow;
    if (!w) return;
    const src = f.src ?? "";
    if (/youtube(-nocookie)?\.com|youtu\.be/.test(src)) {
      w.postMessage(
        JSON.stringify({ event: "command", func: playing ? "playVideo" : "pauseVideo", args: "" }),
        "*",
      );
    } else if (/player\.vimeo\.com/.test(src)) {
      w.postMessage(JSON.stringify({ method: playing ? "play" : "pause" }), "*");
    }
  });
}
