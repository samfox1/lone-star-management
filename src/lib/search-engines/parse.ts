/**
 * Small readers for what a search engine sends back: the Google and Bing clients and the Search
 * tab's model each declared their own copy until 2026-10-05. Pure: no request, no node module, so
 * the Search tab's model can read it too.
 */

/** A calendar day as both engines and the Search tab write it: "2026-10-05". The shape only; days
 *  are compared as strings. */
export const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A count an engine reports (clicks, impressions): a finite number, never below 0. */
export const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
