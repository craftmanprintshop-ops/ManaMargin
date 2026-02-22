/**
 * CommanderDecks Page
 *
 * Browse all commander preconstructed decks with valuations.
 * Displays decks in a grid with total values.
 */

import React, { useState } from 'react'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { commanderService } from '../services/commanderService'
import { DeckList } from '../components/commander/DeckList'
import { ErrorMessage } from '../components/common/ErrorMessage'

/**
 * Commander Decks listing page
 *
 * Fetches all decks from v_commander_deck_values view
 * Shows deck names, codes, and total current values
 */
export const CommanderDecks: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('')

  // Fetch all commander decks
  const {
    data: decks,
    loading,
    error,
    refetch,
  } = useSupabaseQuery(
    () => commanderService.getAllDecks(),
    [] // Only fetch once on mount
  )

  // Filter decks by search term
  const filteredDecks = React.useMemo(() => {
    if (!decks) return []
    if (!searchTerm.trim()) return decks

    const search = searchTerm.toLowerCase()
    return decks.filter((deck) =>
      deck.deck_name?.toLowerCase().includes(search) ||
      deck.code?.toLowerCase().includes(search)
    )
  }, [decks, searchTerm])

  // Handle error
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Commander Decks</h1>
        <ErrorMessage
          title="Failed to load commander decks"
          message={error.message || 'Could not fetch deck data'}
          onRetry={refetch}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Commander Decks</h1>
        <p className="mt-2 text-gray-600">
          Browse preconstructed commander decks with current card valuations
        </p>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <input
          type="text"
          placeholder="Search decks by name or code..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={loading}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
        />
        {filteredDecks && !loading && (
          <p className="mt-2 text-sm text-gray-600">
            Showing {filteredDecks.length} of {decks?.length || 0} decks
          </p>
        )}
      </div>

      {/* Deck Grid */}
      <DeckList decks={filteredDecks} loading={loading} />

      {/* Debug Info (development only) */}
      {import.meta.env.DEV && decks && (
        <div className="bg-gray-100 rounded-lg p-4 text-xs text-gray-600">
          <p className="font-semibold mb-1">Debug Info:</p>
          <p>Total decks loaded: {decks.length}</p>
          <p>Filtered decks: {filteredDecks.length}</p>
        </div>
      )}
    </div>
  )
}
