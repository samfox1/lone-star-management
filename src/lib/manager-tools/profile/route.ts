/**
 * WHERE THE PROFILE TOOL LIVES (Sam, 2026-10-02, PROFILE_TOOL_PLAN.md): /artists/[id]/profile.
 * A tiny module on purpose: the tools rail (a client component) reads it through the registry,
 * and nothing here may pull the country table or the save rules into that bundle.
 */

/** The tool's route under /artists/[id]/ (TOOLS' `seg`). */
export const PROFILE_SEG = 'profile'

/** The id the Bio row carries: a test's pencil and the old SEO routes land on it, and landing
 *  there opens the bio window (_ui/hash.ts). */
export const BIO_ANCHOR = 'bio'
