/**
 * CommanderDeckDetail Page
 *
 * Detailed view of a single commander deck.
 * Shows deck info, full card list, and total valuation.
 */

import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { commanderService } from '../services/commanderService'
import { CardList } from '../components/commander/CardList'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { Card } from '../components/common/Card'
import { formatDate } from '../utils/formatters'
import { ROUTES } from '../utils/constants'

/**
 * Commander deck detail page
 *
 * Fetches deck info and card list from database views:
 * - v_commander_deck_values (for deck info)
 * - v_commander_deck_card_details (for card list with prices)
 */
export const CommanderDeckDetail: React.FC = () => {
  // Get deck code and file name from URL params
  const { code, fileName } = useParams<{ code: string; fileName: string }>()

  // Fetch deck with full details
  const {
    data: deck,
    loading,
    error,
    refetch,
  } = useSupabaseQuery(
    () => commanderService.getDeckWithDetails(code!, fileName!),
    [code, fileName]
  )

  // Loading state
  if (loading) {
    return <LoadingSpinner size="xl" text="Loading deck details..." fullPage />
  }

  // Error state
  if (error || !deck) {
    return (
      <div className="space-y-6">
        <Link
          to={ROUTES.COMMANDER_DECKS}
          className="text-primary-600 hover:text-primary-700 font-medium"
        >
          ← Back to Commander Decks
        </Link>
        <ErrorMessage
          title="Failed to load deck"
          message={error?.message || 'Deck not found'}
          onRetry={refetch}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        to={ROUTES.COMMANDER_DECKS}
        className="inline-flex items-center text-primary-600 hover:text-primary-700 font-medium"
      >
        ← Back to Commander Decks
      </Link>

      {/* Deck Header */}
      <Card>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {deck.deck_name || 'Unknown Deck'}
          </h1>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <span className="font-medium">Code: {deck.code}</span>
            {deck.release_date && (
              <span>Released: {formatDate(deck.release_date, 'long')}</span>
            )}
          </div>
        </div>
      </Card>

      {/* Deck Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-1">Total Cards</p>
            <p className="text-3xl font-bold text-gray-900">
              {deck.cardCount || deck.cards?.length || 0}
            </p>
          </div>
        </Card>

        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-1">Total Deck Value</p>
            <p className="text-3xl font-bold text-primary-600">
              ${deck.totalValue?.toFixed(2) || '0.00'}
            </p>
          </div>
        </Card>

        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-1">Average Card Value</p>
            <p className="text-3xl font-bold text-gray-900">
              $
              {deck.totalValue && deck.cardCount
                ? (deck.totalValue / deck.cardCount).toFixed(2)
                : '0.00'}
            </p>
          </div>
        </Card>
      </div>

      {/* Card List */}
      {deck.cards && <CardList cards={deck.cards} />}

      {/* Debug Info (development only) */}
      {import.meta.env.DEV && (
        <div className="bg-gray-100 rounded-lg p-4 text-xs text-gray-600">
          <p className="font-semibold mb-1">Debug Info:</p>
          <p>Deck Code: {code}</p>
          <p>File Name: {fileName}</p>
          <p>Cards Loaded: {deck.cards?.length || 0}</p>
          <p>
            Cards with Prices:{' '}
            {deck.cards?.filter((c) => c.price !== null).length || 0}
          </p>
        </div>
      )}
    </div>
  )
}
