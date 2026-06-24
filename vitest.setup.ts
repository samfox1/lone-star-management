import '@testing-library/jest-dom/vitest'
import { config } from 'dotenv'

// Tests read Supabase credentials from .env.test (preferred) or .env.local.
config({ path: '.env.test' })
config({ path: '.env.local' })
