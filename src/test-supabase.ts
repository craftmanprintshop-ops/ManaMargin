/**
 * Quick Supabase Connection Test
 *
 * Run this to verify your Supabase credentials are working
 */

import { supabase } from './services/supabase'

async function testConnection() {
  try {
    console.log('Testing Supabase connection...')

    // Try to fetch a simple count from tracked_products
    const { error, count } = await supabase
      .from('tracked_products')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('❌ Supabase Error:', error.message)
      return false
    }

    console.log('✅ Supabase Connected!')
    console.log(`Found ${count} tracked products`)
    return true

  } catch (err) {
    console.error('❌ Connection Error:', err)
    return false
  }
}

// Run the test
testConnection()
