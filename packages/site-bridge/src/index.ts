/**
 * @lone-star/site-bridge — the contract between the lone-star editor and a connected
 * site (SITE_BRIDGE_PLAN.md). Three modules, one import surface:
 *
 *   payload   — the wire shape `get_public_site` returns and `init-data` carries
 *   manifest  — the schema of what a site declares editable
 *   protocol  — the postMessage bridge: message types, guards, version policy
 *
 * Framework-free on purpose: sites call this from server components and plain modules.
 * The frame-side runtime (mountFrameBridge, markers, style resolution) joins in the
 * next slice of phase 1; the React component kit is `@lone-star/site-kit`.
 */
export * from './payload'
export * from './markers'
export * from './styles'
export * from './frame'
export * from './bind'
export * from './vocabulary'
export * from './manifest'
export * from './protocol'
