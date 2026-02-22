/**
 * DeckCard Component
 *
 * Preview card for a commander deck.
 * Shows deck name, release date, and total value.
 */

import React from 'react'
import { Link } from 'react-router-dom'
import type { CommanderDeckValue } from '../../types/models'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { Card } from '../common/Card'

interface DeckCardProps {
  /** Commander deck data */
  deck: CommanderDeckValue
}

/**
 * Commander deck preview card
 *
 * Displays basic deck info and links to detail page
 */
export const DeckCard: React.FC<DeckCardProps> = ({ deck }) => {
  // Build the detail page URL
  const detailUrl = `/commander-decks/${deck.code}/${deck.file_name}`

  return (
    <Link to={detailUrl}>
      <Card hoverable padding="md" className="h-full">
        <div className="flex flex-col h-full">
          {/* Deck Name */}
          <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
            {deck.deck_name || 'Unknown Deck'}
          </h3>

          {/* Deck Code */}
          <p className="text-sm text-gray-500 mb-3">
            {deck.code}
          </p>

          {/* Total Value */}
          {deck.total_value !== null && deck.total_value !== undefined && (
            <div className="mb-3">
              <p className="text-sm text-gray-600">Total Value</p>
              <p className="text-2xl font-bold text-primary-600">
                {formatCurrency(deck.total_value)}
              </p>
            </div>
          )}

          {/* Card Count */}
          {deck.card_count !== null && deck.card_count !== undefined && (
            <p className="text-sm text-gray-600 mb-2">
              {deck.card_count} cards
            </p>
          )}

          {/* Spacer to push button to bottom */}
          <div className="flex-grow"></div>

          {/* View Details Button */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <span className="text-primary-600 font-medium text-sm hover:text-primary-700">
              View Details →
            </span>
          </div>
        </div>
      </Card>
    </Link>
  )
}
