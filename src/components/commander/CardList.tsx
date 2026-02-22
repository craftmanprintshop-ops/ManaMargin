/**
 * CardList Component
 *
 * Table displaying cards in a commander deck with prices.
 * Shows card names, quantities, prices, and total values.
 */

import React, { useMemo } from 'react'
import type { CommanderDeckCardDetail } from '../../types/models'
import { formatCurrency } from '../../utils/formatters'
import { Badge } from '../common/Badge'

interface CardListProps {
  /** Array of cards in the deck */
  cards: CommanderDeckCardDetail[]
  /** Whether cards are loading */
  loading?: boolean
}

/**
 * Table of cards in a commander deck
 *
 * Shows commander first, then sorts by total card value (descending)
 */
export const CardList: React.FC<CardListProps> = ({ cards, loading = false }) => {
  // Calculate total deck value
  const totalValue = useMemo(() => {
    return cards.reduce((sum, card) => sum + (card.total_card_value || 0), 0)
  }, [cards])

  // Separate commander from other cards
  const commander = useMemo(() => {
    return cards.find((card) => card.is_commander)
  }, [cards])

  const otherCards = useMemo(() => {
    return cards.filter((card) => !card.is_commander)
  }, [cards])

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-gray-600">Loading deck cards...</p>
      </div>
    )
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <p className="text-gray-600">No cards found in this deck.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Total Value Header */}
      <div className="bg-primary-50 border-b border-primary-200 px-6 py-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Deck Contents</h3>
          <div className="text-right">
            <p className="text-sm text-gray-600">Total Deck Value</p>
            <p className="text-2xl font-bold text-primary-600">
              {formatCurrency(totalValue)}
            </p>
          </div>
        </div>
      </div>

      {/* Cards Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 border-b border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Card Name
              </th>
              <th className="px-4 py-3 text-center font-semibold text-gray-700">
                Qty
              </th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700">
                Unit Price
              </th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700">
                Total Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Commander Card (if exists) */}
            {commander && (
              <tr className="bg-yellow-50 hover:bg-yellow-100 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {commander.card_name}
                    </span>
                    <Badge variant="warning" size="sm">
                      Commander
                    </Badge>
                    {commander.is_foil && (
                      <Badge variant="info" size="sm">
                        Foil
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-gray-600">
                  {commander.count || 1}
                </td>
                <td className="px-4 py-3 text-right text-gray-900">
                  {formatCurrency(commander.price)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {formatCurrency(commander.total_card_value)}
                </td>
              </tr>
            )}

            {/* Other Cards */}
            {otherCards.map((card, index) => (
              <tr
                key={`${card.card_name}-${index}`}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900">{card.card_name}</span>
                    {card.is_foil && (
                      <Badge variant="info" size="sm">
                        Foil
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-gray-600">
                  {card.count || 1}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatCurrency(card.price)}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  {formatCurrency(card.total_card_value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Total Cards: {cards.length}</span>
          <span>
            Cards with pricing data: {cards.filter((c) => c.price !== null).length}
          </span>
        </div>
      </div>
    </div>
  )
}
