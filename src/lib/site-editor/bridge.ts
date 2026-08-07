/**
 * The BRIDGE protocol — MOVED to `@lone-star/site-bridge` (SITE_BRIDGE_PLAN.md
 * phase 1), where a connected site imports the same module instead of hand-mirroring
 * it (skeen's `lib/frameBridge.ts` was the mirror this retires). This path stays as a
 * re-export so the editor's imports — and the tests that pin the protocol — are
 * unchanged.
 */
export * from '@lone-star/site-bridge/protocol'
