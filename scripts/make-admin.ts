/**
 * Create or promote an ADMIN account, using the service-role key.
 *
 * "Admin" is the `app_metadata.role = 'admin'` JWT claim that is_admin() and RLS
 * trust; a `profiles` row mirrors it for the app layer. Run this in YOUR OWN
 * terminal so no password lands in a shared log:
 *
 *   npm run make:admin -- you@example.com               # creates; PRINTS a generated password
 *   npm run make:admin -- you@example.com 'your-pass'   # creates/updates with your password
 *
 * If the user already exists it is promoted to admin (its password is only
 * changed when you pass one). After running, sign OUT and back in so the new
 * admin claim is minted into your session. Admin tools live at /admin/applications.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const email = process.argv[2]?.trim()
if (!email) {
  console.error('Usage: npm run make:admin -- <email> [password]')
  process.exit(1)
}
const providedPassword = process.argv[3]

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw listErr
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  let userId: string
  let generatedPassword: string | null = null

  if (existing) {
    const attrs: { app_metadata: Record<string, unknown>; password?: string } = {
      app_metadata: { ...existing.app_metadata, role: 'admin' },
    }
    if (providedPassword) attrs.password = providedPassword
    const { error } = await admin.auth.admin.updateUserById(existing.id, attrs)
    if (error) throw error
    userId = existing.id
    console.log(`Promoted existing user ${email} to admin.`)
  } else {
    const password = providedPassword ?? randomBytes(12).toString('base64url')
    if (!providedPassword) generatedPassword = password
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    })
    if (error || !data.user) throw error ?? new Error('could not create user')
    userId = data.user.id
    console.log(`Created admin user ${email}.`)
  }

  const { error: profErr } = await admin.from('profiles').upsert({ user_id: userId, role: 'admin' })
  if (profErr) console.warn(`(profiles mirror warning: ${profErr.message})`)

  console.log('\n  Sign in at /login with:')
  console.log(`    email:    ${email}`)
  if (generatedPassword) {
    console.log(`    password: ${generatedPassword}   <-- generated; change it after signing in`)
  } else {
    console.log('    password: (the one you set)')
  }
  console.log('\n  Then sign out/in once (to mint the admin claim). Admin inbox: /admin/applications\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
