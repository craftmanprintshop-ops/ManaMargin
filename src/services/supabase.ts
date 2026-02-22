/**
 * Supabase Client Configuration
 *
 * This file sets up the type-safe Supabase client for the application.
 * The client is configured with environment variables from .env.local
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

// Get environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Validate that required environment variables are present
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please create a .env.local file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. ' +
    'See .env.local.example for reference.'
  )
}

/**
 * Type-safe Supabase client
 *
 * Usage example:
 * ```typescript
 * import { supabase } from '@/services/supabase'
 *
 * const { data, error } = await supabase
 *   .from('offers_latest_enriched')
 *   .select('*')
 *   .limit(10)
 * ```
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Optional: configure auth persistence
    persistSession: true,
    autoRefreshToken: true,
  },
})

/**
 * Execute a Supabase query with automatic retry on timeout errors.
 *
 * @param queryFn - Function that returns a Supabase query promise
 * @param maxRetries - Number of retries (default 2, so 3 total attempts)
 * @param delayMs - Delay between retries in ms (default 1000)
 */
export async function queryWithRetry<T>(
  queryFn: () => PromiseLike<{ data: T | null; error: any }>,
  maxRetries = 2,
  delayMs = 1000,
): Promise<{ data: T | null; error: any; attempts: number }> {
  let lastError: any = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, delayMs * attempt))
    }
    const { data, error } = await queryFn()
    if (!error) return { data, error: null, attempts: attempt + 1 }
    lastError = error
    const msg = (error.message || '').toLowerCase()
    const isTimeout = msg.includes('timeout') || msg.includes('canceling statement')
    if (!isTimeout) return { data: null, error, attempts: attempt + 1 }
  }
  return { data: null, error: lastError, attempts: maxRetries + 1 }
}

/**
 * Export the client type for use in other files
 */
export type SupabaseClient = typeof supabase
