/**
 * The lane each side panel rides in (the tools rail, the second panel, the assets rail).
 *
 * `round(100%, 1px)`, not `bottom-0`: the root's height is often fractional (829.875px on
 * SEO/GEO), and Chrome rounds the page's scroll height to the NEAREST whole pixel (830).
 * A lane ending at 829.875 is then short by the difference, and at the very bottom of
 * the scroll the sticky panel was pushed up by it (measured: up to half a pixel). Rounded
 * the same way, the lane ends exactly where the page does, and never past it, so it adds
 * no scroll of its own.
 *
 * `bottom-0` stays as the FALLBACK: a browser without CSS round() drops that height as
 * invalid, and top + bottom size the lane. Where round() works, the height wins over bottom.
 *
 * Here in the dashboard folder because both rails ride in it: the tools rail
 * ((manager-tools)/_shell/tools-rail.tsx) and the assets rail (assets-rail.tsx). It sat in
 * tools-rail.tsx until 2026-10-05, which made the assets rail import from inside the tools. Why a
 * lane at all, and why sticky: tools-rail.tsx, RIDING THE BOUNCE.
 */
export const RAIL_LANE = 'absolute top-0 bottom-0 h-[round(100%,1px)]'
