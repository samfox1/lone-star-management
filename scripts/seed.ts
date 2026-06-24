/**
 * Seed two artists + two managers + one admin.
 *
 * Two tenants are the minimum needed to test isolation (manager A must never
 * reach artist B). Run AFTER the schema is pushed:
 *
 *   npm run db:seed
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * The service-role key bypasses RLS — this script is one of the only two places
 * that is allowed to (migrations/seeding being the other).
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { publishProfile } from '../src/lib/content'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'lonestar-dev-password'

type SeedUser = { email: string; role: 'admin' | 'manager' }

/** Create the auth user if absent; return its id either way. Idempotent. */
async function ensureUser({ email, role }: SeedUser): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers()
  const existing = list?.users.find((u) => u.email === email)

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      app_metadata: { role },
    })
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role },
  })
  if (error || !data.user) throw error ?? new Error(`could not create ${email}`)
  return data.user.id
}

/** Upsert an artist by its unique slug; return its id. */
async function ensureArtist(slug: string, name: string, bio: string): Promise<string> {
  const { data, error } = await admin
    .from('artists')
    .upsert({ slug, name, bio }, { onConflict: 'slug' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function main() {
  // Users
  const adminId = await ensureUser({ email: 'admin@lonestar.test', role: 'admin' })
  const managerAId = await ensureUser({ email: 'manager-a@lonestar.test', role: 'manager' })
  const managerBId = await ensureUser({ email: 'manager-b@lonestar.test', role: 'manager' })

  // Profiles (role mirrors the JWT claim for app-layer convenience)
  await admin.from('profiles').upsert([
    { user_id: adminId, role: 'admin' },
    { user_id: managerAId, role: 'manager' },
    { user_id: managerBId, role: 'manager' },
  ])

  // Two tenants
  const artistAId = await ensureArtist(
    'lone-pine',
    'Lone Pine',
    'Dusty alt-country out of West Texas.',
  )
  const artistBId = await ensureArtist(
    'gulf-static',
    'Gulf Static',
    'Coastal dream-pop from the Gulf shore.',
  )

  // Membership: A manages Lone Pine, B manages Gulf Static. No overlap — this is
  // the isolation boundary the milestone-2 tests will probe.
  await admin.from('artist_managers').upsert([
    { user_id: managerAId, artist_id: artistAId },
    { user_id: managerBId, artist_id: artistBId },
  ])

  // A site is "live" only once its profile is published. Publish each seeded
  // artist's profile so a fresh environment renders (the migration backfill only
  // covers artists that existed at migration time).
  await publishProfile(admin, artistAId)
  await publishProfile(admin, artistBId)

  console.log('Seeded:')
  console.log(`  admin       admin@lonestar.test       (${adminId})`)
  console.log(`  manager A   manager-a@lonestar.test   -> Lone Pine    (${artistAId})`)
  console.log(`  manager B   manager-b@lonestar.test   -> Gulf Static  (${artistBId})`)
  console.log(`  password for all: ${PASSWORD}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
