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
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">Commander Decks</h1>
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
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">Commander Decks</h1>
        <p className="mt-2 text-[var(--text-2)]">
          Browse preconstructed commander decks with current card valuations
        </p>
      </div>

      {/* Search Bar */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-md border border-[var(--border-color)] p-4">
        <input
          type="text"
          placeholder="Search decks by name or code..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={loading}
          className="w-full px-4 py-2 border border-[var(--border-color)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-[var(--bg-inset)] bg-[var(--bg-surface)] text-[var(--text-1)]"
        />
        {filteredDecks && !loading && (
          <p className="mt-2 text-sm text-[var(--text-2)]">
            Showing {filteredDecks.length} of {decks?.length || 0} decks
          </p>
        )}
      </div>

      {/* Deck Grid */}
      <DeckList decks={filteredDecks} loading={loading} />

      {/* Debug Info (development only) */}
      {import.meta.env.DEV && decks && (
        <div className="bg-[var(--bg-inset)] rounded-lg p-4 text-xs text-[var(--text-2)]">
          <p className="font-semibold mb-1">Debug Info:</p>
          <p>Total decks loaded: {decks.length}</p>
          <p>Filtered decks: {filteredDecks.length}</p>
        </div>
      )}
    </div>
  )
}
