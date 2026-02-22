/**
 * PackSimulator Page
 *
 * Virtual booster pack opening simulator.
 * Users select a set and number of packs, then see results and statistics.
 */

import React, { useState } from 'react'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { packSimulatorService } from '../services/packSimulatorService'
import { SetSelector } from '../components/simulator/SetSelector'
import { PackResults } from '../components/simulator/PackResults'
import { SimulationStats } from '../components/simulator/SimulationStats'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import type { SimulationResults } from '../types/models'

/**
 * Pack Simulator page
 *
 * Allows users to:
 * 1. Select a set (loaded from database)
 * 2. Choose number of packs to open (10, 20, 30, 40, 50)
 * 3. Simulate pack openings
 * 4. View individual pack results
 * 5. See overall statistics (avg value, median, best, worst)
 */
export const PackSimulator: React.FC = () => {
  const [selectedSet, setSelectedSet] = useState('')
  const [packCount, setPackCount] = useState(10)
  const [isSimulating, setIsSimulating] = useState(false)
  const [results, setResults] = useState<SimulationResults | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch available sets from database
  const {
    data: availableSets,
    loading: setsLoading,
    error: setsError,
  } = useSupabaseQuery(
    () => packSimulatorService.getAvailableSets(),
    [] // Only fetch once on mount
  )

  /**
   * Run the pack simulation
   */
  const handleSimulate = async () => {
    if (!selectedSet) {
      setError('Please select a set')
      return
    }

    setIsSimulating(true)
    setError(null)
    setResults(null)

    try {
      console.log(`Starting simulation for ${selectedSet} (${packCount} packs)`)
      const simulationResults = await packSimulatorService.simulateMultiplePacks(
        selectedSet,
        packCount
      )
      setResults(simulationResults)
    } catch (err) {
      console.error('Simulation error:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to simulate pack openings. Please try again.'
      )
    } finally {
      setIsSimulating(false)
    }
  }

  /**
   * Reset simulation
   */
  const handleReset = () => {
    setResults(null)
    setError(null)
  }

  // Show error if sets failed to load
  if (setsError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Pack Simulator</h1>
        <ErrorMessage
          title="Failed to load available sets"
          message={setsError.message || 'Could not fetch sets from database'}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  // Show loading while fetching sets
  if (setsLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Pack Simulator</h1>
        <LoadingSpinner size="lg" text="Loading available sets..." />
      </div>
    )
  }

  // Show message if no sets available
  if (!availableSets || availableSets.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Pack Simulator</h1>
        <ErrorMessage
          title="No sets available"
          message="No cards found in your database. Please check the following:"
          boxed
        />
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-6">
          <h3 className="font-semibold text-[var(--text-1)] mb-3">Troubleshooting Steps:</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--text-2)]">
            <li>
              <strong>Check if cards table exists:</strong> Go to Supabase Studio → Table Editor → Look for "cards" table
            </li>
            <li>
              <strong>Verify table has data:</strong> The cards table should have rows with a "set_code" column
            </li>
            <li>
              <strong>Check Row Level Security (RLS):</strong> Go to Supabase Studio → Authentication → Policies
              <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                <li>If RLS is enabled on "cards" table, you need a policy allowing SELECT for anonymous users</li>
                <li>Quick fix: Run this SQL in Supabase SQL Editor:</li>
              </ul>
              <pre className="mt-2 p-3 bg-black/40 text-[var(--text-1)] rounded text-xs overflow-x-auto">
{`-- Allow anonymous users to read cards
CREATE POLICY "Enable read access for all users" ON "public"."cards"
FOR SELECT USING (true);`}
              </pre>
            </li>
            <li>
              <strong>Check browser console (F12):</strong> Look for error messages with details about what failed
            </li>
            <li>
              <strong>Verify Supabase connection:</strong> Make sure your .env.local has correct VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
            </li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Pack Simulator</h1>
        <p className="mt-2 text-[var(--text-2)]">
          Open virtual booster packs and calculate expected value based on current market prices
        </p>
      </div>

      {/* Set Selector */}
      <SetSelector
        selectedSet={selectedSet}
        onSetChange={setSelectedSet}
        packCount={packCount}
        onPackCountChange={setPackCount}
        onSimulate={handleSimulate}
        isSimulating={isSimulating}
        availableSets={availableSets}
      />

      {/* Available Sets Info */}
      {availableSets && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-sm text-blue-300">
            <strong>{availableSets.length} sets available:</strong>{' '}
            {availableSets.slice(0, 10).join(', ')}
            {availableSets.length > 10 && `, and ${availableSets.length - 10} more...`}
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <ErrorMessage
          title="Simulation Error"
          message={error}
          onRetry={handleSimulate}
          boxed
        />
      )}

      {/* Results Section */}
      {results && (
        <>
          {/* Statistics Summary */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-[var(--text-1)]">
                Simulation Results
              </h2>
              <button
                onClick={handleReset}
                className="text-primary-600 hover:text-primary-700 font-medium text-sm"
              >
                Reset Simulation
              </button>
            </div>
            <SimulationStats results={results} />
          </div>

          {/* Individual Pack Results */}
          <div>
            <h3 className="text-xl font-semibold text-[var(--text-1)] mb-4">
              Pack Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.packs.map((pack, index) => (
                <PackResults
                  key={index}
                  pack={pack}
                  packNumber={index + 1}
                />
              ))}
            </div>
          </div>

          {/* Summary Info */}
          <div className="bg-primary-500/10 border border-primary-500/20 rounded-lg p-6">
            <h3 className="font-semibold text-[var(--text-1)] mb-2">
              What does this mean?
            </h3>
            <div className="text-sm text-[var(--text-2)] space-y-2">
              <p>
                <strong>Average Pack Value:</strong> The expected value you'd get per pack if you opened many packs.
                This is the most important number for calculating if a box is worth buying.
              </p>
              <p>
                <strong>Median Value:</strong> The "middle" pack value. Half of your packs will be worth more, half less.
              </p>
              <p>
                <strong>Best/Worst Pack:</strong> Shows the range of variance. MTG packs can vary wildly in value!
              </p>
              <p className="text-xs text-[var(--text-2)] mt-3">
                Note: Values are based on current TCGPlayer market prices and may fluctuate.
                This simulator uses standard pack configuration (1 rare/mythic, 3 uncommons, 10 commons, with foil chances).
              </p>
            </div>
          </div>
        </>
      )}

      {/* Initial Instructions */}
      {!results && !isSimulating && !error && (
        <div className="bg-white/5 rounded-lg p-8 text-center">
          <h3 className="text-lg font-semibold text-[var(--text-1)] mb-2">
            Ready to simulate!
          </h3>
          <p className="text-[var(--text-2)] max-w-2xl mx-auto">
            Select a set and number of packs above, then click "Open Packs" to see what you'd pull.
            The simulator uses real card prices to calculate the expected value.
          </p>
        </div>
      )}

      {/* Debug Info (development only) */}
      {import.meta.env.DEV && results && (
        <div className="bg-white/5 rounded-lg p-4 text-xs text-[var(--text-2)]">
          <p className="font-semibold mb-1">Debug Info:</p>
          <p>Set: {selectedSet}</p>
          <p>Packs Opened: {results.totalPacks}</p>
          <p>
            Total Cards: {results.packs.reduce((sum, p) => sum + p.cards.length, 0)}
          </p>
          <p>
            Total Value: $
            {results.packs.reduce((sum, p) => sum + p.totalValue, 0).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  )
}
