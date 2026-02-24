/**
 * PackResults Component
 *
 * Displays the cards from opened packs.
 * Shows card names, rarities, prices, and highlights special cards.
 */

import React from 'react'
import type { PackOpeningResult } from '../../types/models'
import { formatCurrency, formatRarity } from '../../utils/formatters'
import { Badge } from '../common/Badge'

interface PackResultsProps {
  /** Pack opening result */
  pack: PackOpeningResult
  /** Pack number (for display) */
  packNumber?: number
}

/**
 * Display results from opening a single pack
 */
export const PackResults: React.FC<PackResultsProps> = ({
  pack,
  packNumber,
}) => {
  // Sort cards by value (highest first)
  const sortedCards = [...pack.cards].sort((a, b) => b.price - a.price)

  // Get the most valuable card
  const bestCard = sortedCards[0]

  return (
    <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-2xl p-4">
      {/* Pack Header */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[var(--border-color-2)]">
        <h3 className="font-semibold text-[var(--text-1)]">
          {packNumber ? `Pack #${packNumber}` : 'Pack Results'}
        </h3>
        <div className="text-right">
          <p className="text-xs text-[var(--text-2)]">Total Value</p>
          <p className="text-xl font-bold text-primary-600">
            {formatCurrency(pack.totalValue)}
          </p>
        </div>
      </div>

      {/* Best Card Highlight */}
      {bestCard && bestCard.price > 0 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <p className="text-xs font-medium text-amber-400 mb-1">Best Pull:</p>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[var(--text-1)] truncate">{bestCard.name}</span>
              {bestCard.foil && (
                <Badge variant="info" size="sm">
                  Foil
                </Badge>
              )}
            </div>
            <span className="font-bold text-amber-400 shrink-0 ml-2">
              {formatCurrency(bestCard.price)}
            </span>
          </div>
        </div>
      )}

      {/* Card List */}
      <div className="space-y-1">
        {sortedCards.map((card, index) => {
          const { text: rarityText, colorClass } = formatRarity(card.rarity)

          return (
            <div
              key={`${card.uuid}-${index}`}
              className="flex justify-between items-center py-2 px-3 hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm text-[var(--text-1)] truncate">
                  {card.name}
                </span>
                <span className={`text-xs font-medium shrink-0 ${colorClass}`}>
                  {rarityText}
                </span>
                {card.foil && (
                  <Badge variant="info" size="sm">
                    Foil
                  </Badge>
                )}
              </div>
              <span className="text-sm font-medium text-[var(--text-1)] ml-2 shrink-0">
                {formatCurrency(card.price)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Pack Stats */}
      <div className="mt-4 pt-3 border-t border-[var(--border-color-2)] grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="text-[var(--text-2)]">Total Cards</p>
          <p className="font-semibold text-[var(--text-1)]">{pack.cards.length}</p>
        </div>
        <div>
          <p className="text-[var(--text-2)]">Rares/Mythics</p>
          <p className="font-semibold text-[var(--text-1)]">{pack.rareCards.length}</p>
        </div>
        <div>
          <p className="text-[var(--text-2)]">Foils</p>
          <p className="font-semibold text-[var(--text-1)]">{pack.foilCards.length}</p>
        </div>
      </div>
    </div>
  )
}
