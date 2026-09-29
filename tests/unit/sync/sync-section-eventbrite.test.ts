// The Tour page's Sync and a connection's Pull now reach Eventbrite through the one section action.
/**
 * Eventbrite is not in `INTEGRATIONS` (its sign-in is a Vault token, not an artist column),
 * so `syncSectionAction` resolves it by name for the tour section — the Shopify pattern for
 * merch. Without this, "Pull now" on the Eventbrite row answered "Eventbrite isn't
 * connected." forever.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/artists/[id]/(dashboard)/integrations', () => ({
  INTEGRATIONS: [{ key: 'bandsintown', label: 'Bandsintown', section: 'tour', pull: vi.fn(async () => ({ ok: true, message: 'Already up to date' })) }],
}))
vi.mock('@/app/artists/[id]/(dashboard)/merch/actions', () => ({ syncShopifyAction: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/tour/eventbrite-actions', () => ({
  syncEventbriteAction: vi.fn(async () => ({ ok: true, message: '3 added', notes: [] })),
}))

import { syncEventbriteAction } from '@/app/artists/[id]/(dashboard)/tour/eventbrite-actions'
import { syncSectionAction } from '@/app/artists/[id]/(dashboard)/sync-section-action'

describe('syncSectionAction — Eventbrite', () => {
  it('CRITICAL: tour + eventbrite runs the Eventbrite pull, on its own line', async () => {
    const { results } = await syncSectionAction('a1', 'tour', ['bandsintown', 'eventbrite'])
    expect(syncEventbriteAction).toHaveBeenCalledWith('a1')
    expect(results.map((r) => [r.key, r.ok, r.message])).toEqual([
      ['bandsintown', true, 'Already up to date'],
      ['eventbrite', true, '3 added'],
    ])
  })

  it('not asked for, not run; and never from another section', async () => {
    await syncSectionAction('a1', 'tour', ['bandsintown'])
    await syncSectionAction('a1', 'music', ['eventbrite'])
    expect(syncEventbriteAction).not.toHaveBeenCalled()
  })
})
