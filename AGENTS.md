<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase CLI: never `npx supabase`

Use the installed CLI directly (`supabase db push`, `supabase migration list`) or the
npm scripts (`npm run db:push`). **Never `npx supabase`.**

`supabase` is NOT a dependency of this project, so npx silently downloads its own
copy (~162 MB) into `~/.npm/_npx/` and runs *that* instead. Two things break:

- **It re-prompts for your macOS keychain password, forever.** The CLI reads its
  access token from the login keychain, and macOS grants that per *binary*. The npx
  copy is a different executable from `/opt/homebrew/bin/supabase`, so "Always Allow"
  on the real one never covers it.
- **It's a different CLI version.** npx pulls latest (2.109.1) while the installed one
  was 2.90.0 — so migrations get pushed by a different CLI than the one everything
  else is verified with. Nobody notices until they do.

(If `SUPABASE_ACCESS_TOKEN` is set in the environment, the CLI skips the keychain
entirely and neither binary prompts — but the version-skew reason stands regardless.)
