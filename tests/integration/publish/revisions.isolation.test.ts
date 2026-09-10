/**
 * `revisions` and `site_styles` — the two per-artist tables that decide what a live
 * public site looks like. Neither had an isolation test of any kind.
 *
 * revisions_rw is the higher-stakes of the pair. `revisions` IS the published site:
 * get_public_site reads the latest revision per entity and returns it to anonymous
 * visitors. A cross-tenant INSERT here is not a data leak, it is unauthenticated
 * PUBLICATION — attacker-chosen text and links appearing on somebody else's live site,
 * with no draft row anywhere in the dashboard to explain where it came from.
 *
 * site_styles_rw carries the class strings the editor writes per region. Cross-tenant
 * writes there are defacement of the same live site by a different route.
 *
 * Both are enforced only by RLS (is_manager_of), so both can only be checked against the
 * real database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectRlsDenied } from '@tests/helpers/rls'

const svc = serviceClient()

let artistB: string
let asA: SupabaseClient

const B_REVISION_TITLE = 'ISO-REV B published title'
const B_REGION = 'iso_probe_region'
const B_CLASSES = 'iso-b-original-classes'

let revisionB: string
let styleB: string
/** Anything a test manages to create despite the policies, so teardown is complete. */
const strayRevisionIds: string[] = []

beforeAll(async () => {
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)

  const rev = await svc
    .from('revisions')
    .insert({
      artist_id: artistB,
      entity_type: 'track',
      entity_id: null,
      data: { title: B_REVISION_TITLE },
    })
    .select('id')
    .single()
  if (rev.error || !rev.data) throw rev.error ?? new Error('seed B revision failed')
  revisionB = rev.data.id

  await svc.from('site_styles').delete().eq('artist_id', artistB).eq('region_key', B_REGION)
  const style = await svc
    .from('site_styles')
    .insert({ artist_id: artistB, region_key: B_REGION, class_names: B_CLASSES })
    .select('id')
    .single()
  if (style.error || !style.data) throw style.error ?? new Error('seed B site_styles failed')
  styleB = style.data.id
})

afterAll(async () => {
  if (revisionB) await svc.from('revisions').delete().eq('id', revisionB)
  if (strayRevisionIds.length) await svc.from('revisions').delete().in('id', strayRevisionIds)
  if (styleB) await svc.from('site_styles').delete().eq('id', styleB)
})

describe('revisions — publishing into another tenant', () => {
  it('the B fixture revision really exists (service role)', async () => {
    const { data } = await svc.from('revisions').select('id').eq('id', revisionB)
    expect(data).toHaveLength(1)
  })

  it("CRITICAL: A cannot READ B's revisions", async () => {
    const { data } = await asA.from('revisions').select('id, data').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot PUBLISH into B's site", async () => {
    // The whole attack in one statement: insert a revision under B's artist_id and it
    // becomes the latest snapshot for that entity, i.e. live content on B's public site.
    const { data, error } = await asA
      .from('revisions')
      .insert({
        artist_id: artistB,
        entity_type: 'link',
        entity_id: null,
        data: { label: 'ISO-REV forged link', url: 'https://attacker.example' },
      })
      .select('id')
    expectRlsDenied(error, "A publishing a revision into B's site")
    if (data?.length) strayRevisionIds.push(...data.map((r) => r.id))

    // And confirm nothing reached the public door.
    const { data: site } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistBSlug })
    expect(JSON.stringify(site)).not.toContain('ISO-REV forged link')
  })

  it("CRITICAL: A cannot REWRITE B's published snapshot (silent, so check the row)", async () => {
    // No policy matches, so RLS scopes the row out of the UPDATE and PostgREST reports
    // success over zero rows. The stored `data` is the only evidence.
    await asA.from('revisions').update({ data: { title: 'HACKED' } }).eq('id', revisionB)

    const { data } = await svc.from('revisions').select('data').eq('id', revisionB).single()
    expect((data?.data as { title?: string })?.title).toBe(B_REVISION_TITLE)
  })

  it("CRITICAL: A cannot UNPUBLISH B's site by deleting revisions (silent no-op)", async () => {
    await asA.from('revisions').delete().eq('id', revisionB)
    const { data } = await svc.from('revisions').select('id').eq('id', revisionB)
    expect(data, "A deleted another tenant's published snapshot").toHaveLength(1)
  })

  it('CRITICAL: anon cannot read revisions directly (get_public_site is the only door)', async () => {
    const { data } = await anonClient().from('revisions').select('id').limit(1)
    expect(data ?? []).toEqual([])
  })

  it('CRITICAL: anon cannot publish', async () => {
    const { error } = await anonClient()
      .from('revisions')
      .insert({ artist_id: artistB, entity_type: 'link', entity_id: null, data: { label: 'anon' } })
      .select()
    expectRlsDenied(error, 'anon publishing a revision')
  })
})

describe('site_styles — cross-tenant defacement', () => {
  it('the B fixture style really exists (service role)', async () => {
    const { data } = await svc.from('site_styles').select('id').eq('id', styleB)
    expect(data).toHaveLength(1)
  })

  it("CRITICAL: A cannot READ B's site_styles", async () => {
    const { data } = await asA.from('site_styles').select('*').eq('artist_id', artistB)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot INSERT a style region into B's tenant", async () => {
    const { error } = await asA
      .from('site_styles')
      .insert({ artist_id: artistB, region_key: 'iso_forged_region', class_names: 'hidden' })
      .select()
    expectRlsDenied(error, "A inserting a style into B's tenant")
  })

  it("CRITICAL: A cannot UPDATE or DELETE B's style row (both silent)", async () => {
    await asA.from('site_styles').update({ class_names: 'hacked' }).eq('id', styleB)
    await asA.from('site_styles').delete().eq('id', styleB)

    const { data } = await svc.from('site_styles').select('class_names').eq('id', styleB)
    expect(data).toHaveLength(1)
    expect(data![0].class_names).toBe(B_CLASSES)
  })

  it('CRITICAL: anon cannot read site_styles directly', async () => {
    const { data } = await anonClient().from('site_styles').select('id').limit(1)
    expect(data ?? []).toEqual([])
  })
})
