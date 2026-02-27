/**
 * Database Diagnostic Page
 *
 * Tests database connections and shows what data is available.
 * Helps troubleshoot RLS policies and missing views.
 */

import React, { useState } from 'react'
import { supabase } from '../services/supabase'
import { Card } from '../components/common/Card'
import { Button } from '../components/common/Button'

interface DiagnosticResult {
  name: string
  status: 'success' | 'error' | 'pending'
  count?: number
  error?: string
  sample?: any
}

export const DatabaseDiagnostic: React.FC = () => {
  const [results, setResults] = useState<DiagnosticResult[]>([])
  const [availableTables, setAvailableTables] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const listAllTables = async () => {
    try {
      // Query the information_schema to get all tables and views
      const { data, error } = await supabase
        .rpc('list_tables')
        .select('*')

      if (error) {
        console.log('Cannot use RPC, trying direct query approach')
        // Fallback: try to query common table names and see which ones exist
        const commonTables = [
          'cards', 'offers', 'commander_deck_info', 'commander_deck_cards',
          'v_cards_by_set_rarity', 'v_card_latest_price', 'v_commander_deck_values',
          'v_commander_deck_card_details', 'offers_latest_enriched',
          'allprintings_cards', 'allprintings_sets', 'booster_recipes'
        ]

        const existing: string[] = []
        for (const table of commonTables) {
          try {
            const { error } = await supabase
              .from(table)
              .select('*', { count: 'exact', head: true })
              .limit(0)

            if (!error || error.code !== '42P01') { // 42P01 = table does not exist
              existing.push(table)
            }
          } catch (e) {
            // Skip
          }
        }
        setAvailableTables(existing)
      } else {
        const tableData = (data ?? []) as any[]
        setAvailableTables(tableData.map((t: any) => t.table_name) || [])
      }
    } catch (err) {
      console.error('Error listing tables:', err)
    }
  }

  const runDiagnostics = async () => {
    setIsRunning(true)
    await listAllTables()
    const diagnosticResults: DiagnosticResult[] = []

    // Test 1: Check cards table
    try {
      const { data, error, count } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'cards table',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'cards table',
        status: 'error',
        error: err.message
      })
    }

    // Test 2: Check v_cards_by_set_rarity view
    try {
      const { data, error, count } = await supabase
        .from('v_cards_by_set_rarity')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'v_cards_by_set_rarity view',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'v_cards_by_set_rarity view',
        status: 'error',
        error: err.message
      })
    }

    // Test 3: Check v_card_latest_price view
    try {
      const { data, error, count } = await supabase
        .from('v_card_latest_price')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'v_card_latest_price view',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'v_card_latest_price view',
        status: 'error',
        error: err.message
      })
    }

    // Test 4: Check offers_latest_enriched view
    try {
      const { data, error, count } = await supabase
        .from('offers_latest_enriched')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'offers_latest_enriched view',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'offers_latest_enriched view',
        status: 'error',
        error: err.message
      })
    }

    // Test 5: Check v_commander_deck_values view
    try {
      const { data, error, count } = await supabase
        .from('v_commander_deck_values')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'v_commander_deck_values view',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'v_commander_deck_values view',
        status: 'error',
        error: err.message
      })
    }

    // Test 6: Check v_commander_deck_card_details view
    try {
      const { data, error, count } = await supabase
        .from('v_commander_deck_card_details')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'v_commander_deck_card_details view',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'v_commander_deck_card_details view',
        status: 'error',
        error: err.message
      })
    }

    // Test 7: Check commander_decks table
    try {
      const { data, error, count } = await supabase
        .from('commander_decks')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'commander_decks table',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'commander_decks table',
        status: 'error',
        error: err.message
      })
    }

    // Test 7b: Check commander_deck_cards table
    try {
      const { data, error, count } = await supabase
        .from('commander_deck_cards')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'commander_deck_cards table',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'commander_deck_cards table',
        status: 'error',
        error: err.message
      })
    }

    // Test 8: Check offers table
    try {
      const { data, error, count } = await supabase
        .from('offers')
        .select('*', { count: 'exact', head: false })
        .limit(5)

      diagnosticResults.push({
        name: 'offers table',
        status: error ? 'error' : 'success',
        count: count || 0,
        error: error?.message,
        sample: data?.[0]
      })
    } catch (err: any) {
      diagnosticResults.push({
        name: 'offers table',
        status: 'error',
        error: err.message
      })
    }

    setResults(diagnosticResults)
    setIsRunning(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)] mb-2">
          Database Diagnostic
        </h1>
        <p className="text-[var(--text-2)]">
          Test database connections and check RLS policies
        </p>
      </div>

      <Card>
        <Button
          onClick={runDiagnostics}
          loading={isRunning}
          disabled={isRunning}
        >
          Run Diagnostics
        </Button>
      </Card>

      {availableTables.length > 0 && (
        <Card>
          <h3 className="font-semibold text-[var(--text-1)] mb-3">
            Available Tables & Views ({availableTables.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {availableTables.map(table => (
              <div
                key={table}
                className="text-sm font-mono text-[var(--text-2)] bg-[var(--bg-inset)] px-2 py-1 rounded"
              >
                {table}
              </div>
            ))}
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((result, index) => (
            <Card key={index}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-[var(--text-1)]">
                    {result.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                        result.status === 'success'
                          ? 'bg-[var(--color-buy-bg)] text-[var(--color-buy)]'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {result.status === 'success' ? '✓ Success' : '✗ Error'}
                    </span>
                    {result.count !== undefined && (
                      <span className="text-sm text-[var(--text-2)]">
                        {result.count} rows
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {result.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded p-3 mb-3">
                  <p className="text-sm text-red-400 font-mono">
                    {result.error}
                  </p>
                </div>
              )}

              {result.sample && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-[var(--text-2)] hover:text-[var(--text-1)]">
                    Show sample data
                  </summary>
                  <pre className="mt-2 p-3 bg-[var(--bg-inset)] rounded text-xs overflow-x-auto">
                    {JSON.stringify(result.sample, null, 2)}
                  </pre>
                </details>
              )}

              {result.status === 'error' && result.error?.includes('permission denied') && (
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                  <p className="text-sm text-yellow-400 font-semibold mb-2">
                    RLS Policy Issue Detected
                  </p>
                  <p className="text-xs text-[var(--text-2)] mb-2">
                    This table/view needs an RLS policy to allow anonymous access. Run this SQL in Supabase SQL Editor:
                  </p>
                  <pre className="text-xs bg-[var(--bg-inset)] p-2 rounded overflow-x-auto">
{`-- Allow anonymous read access to ${result.name}
ALTER TABLE "${result.name}" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON "${result.name}"
FOR SELECT USING (true);`}
                  </pre>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <Card>
          <h3 className="font-semibold text-[var(--text-1)] mb-3">
            Summary
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-[var(--text-2)]">Successful</p>
              <p className="text-2xl font-bold text-[var(--color-buy)]">
                {results.filter(r => r.status === 'success').length}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--text-2)]">Failed</p>
              <p className="text-2xl font-bold text-red-400">
                {results.filter(r => r.status === 'error').length}
              </p>
            </div>
          </div>

          {results.filter(r => r.status === 'error').length > 0 && (
            <div className="mt-4 p-4 bg-[var(--bg-set-row)] border border-[var(--brand)]/20 rounded">
              <p className="text-sm font-semibold text-[var(--brand)] mb-2">
                Quick Fix for All Tables
              </p>
              <p className="text-xs text-[var(--text-2)] mb-2">
                Run this SQL to enable anonymous read access for all tables and views:
              </p>
              <pre className="text-xs bg-[var(--bg-inset)] p-3 rounded overflow-x-auto">
{`-- Enable RLS and create policies for all tables
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Enable read for all" ON %I', table_name);
    EXECUTE format('CREATE POLICY "Enable read for all" ON %I FOR SELECT USING (true)', table_name);
  END LOOP;
END $$;`}
              </pre>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
