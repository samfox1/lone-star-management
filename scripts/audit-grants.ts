/**
 * npm run audit:grants — which functions in `public` can ANON execute, and are they all
 * meant to be public doors?
 *
 * WHY. Supabase's default privileges on `public` grant EXECUTE on every new function to
 * `anon`, `authenticated` and `service_role` BY ROLE. A `revoke all … from public` does
 * not touch those role grants, so a function meant for managers or the service key stays
 * callable by anon until someone writes `from public, anon, authenticated`. This bit
 * `submit_enquiry` (2026-08-04) and `record_event_v2` (2026-09-11), and left four analytics
 * readers and two manager RPCs anon-executable for weeks. AGENTS.md has the rule; this is
 * the check that does not depend on anyone remembering it.
 *
 * Runs `supabase db query --linked` (the installed CLI, never npx — see AGENTS.md) and
 * diffs anon-executable functions against the allowlist below. Exit 1 on any surprise.
 *
 * The allowlist is the set of INTENDED anon doors (ADR 0001 / 0010) plus the helpers RLS
 * policies call as the anon role, plus trigger/event-trigger functions PostgREST cannot
 * invoke anyway. Adding a name here is a decision — say why in the comment.
 */
import { execFileSync } from 'node:child_process'

const ALLOWED: Record<string, string> = {
  // Public doors (ADR 0001): resolve the tenant from the slug, return published data only.
  get_public_site: 'the public site payload',
  get_release: 'one release smart-link page',
  get_public_releases: 'released music for the site',
  audio_path_for_play: 'signed audio for a published track',
  record_event: 'analytics ingest (anon) — closes at the step-5 cut-over, then remove this line',
  subscribe: 'mailing-list signup',
  submit_application: 'the roster application form',
  public_custom_site: 'redirect target for custom-hosted sites',
  // RLS helpers: policy expressions run as the calling role, so anon must be able to call them.
  is_admin: 'RLS helper',
  is_manager_of: 'RLS helper',
  // Trigger functions: not callable through PostgREST regardless of grant.
  set_updated_at: 'trigger',
  rls_auto_enable: 'event trigger',
}

const SQL = `
  select p.proname
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('anon', p.oid, 'execute')
  order by 1
`

function anonExecutable(): string[] {
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--agent=no', '-o', 'json', SQL], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const start = out.indexOf('[')
  const end = out.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error(`unexpected CLI output:\n${out}`)
  const rows = JSON.parse(out.slice(start, end + 1)) as { proname: string }[]
  return rows.map((r) => r.proname)
}

const found = anonExecutable()
const unexpected = found.filter((f) => !(f in ALLOWED))
const missing = Object.keys(ALLOWED).filter((f) => !found.includes(f))

console.log(`anon can execute ${found.length} function(s) in public:`)
for (const f of found) console.log(`  ${unexpected.includes(f) ? '✗' : '✓'} ${f}${f in ALLOWED ? `  — ${ALLOWED[f]}` : ''}`)
if (missing.length) console.log(`\nallowlisted but no longer anon-executable (remove from ALLOWED?): ${missing.join(', ')}`)
if (unexpected.length) {
  console.error(`\n${unexpected.length} function(s) anon can execute that are not intended doors. Fix with:`)
  for (const f of unexpected) console.error(`  revoke all on function public.${f}(…) from public, anon, authenticated; -- then grant what is meant`)
  process.exit(1)
}
console.log('\nOK — every anon-executable function is an intended door.')
