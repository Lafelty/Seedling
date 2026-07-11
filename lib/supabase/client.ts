import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

// Single shared instance — every page/component calls createClient(), so
// without memoization each call spins up a new GoTrueClient against the same
// storage key. Only ever constructed in the browser ('use client' callers).
let client: ReturnType<typeof createBrowserClient<Database>> | undefined

export function createClient() {
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return client
}
