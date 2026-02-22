/**
 * DeckList Component
 *
 * Grid display of commander deck cards.
 * Shows all decks in a responsive grid layout.
 */

import React from 'react'
import type { CommanderDeckValue } from '../../types/models'
import { DeckCard } from './DeckCard'
import { LoadingSpinner } from '../common/LoadingSpinner'

interface DeckListProps {
  /** Array of commander decks to display */
  decks: CommanderDeckValue[]
  /** Whether decks are loading */
  loading?: boolean
}

/**
 * Grid of commander deck cards
 *
 * Responsive layout: 1 column on mobile, 2 on tablet, 3 on desktop
 */
export const DeckList: React.FC<DeckListProps> = ({ decks, loading = false }) => {
  if (loading) {
    return <LoadingSpinner size="lg" text="Loading commander decks..." />
  }

  if (!decks || decks.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <p className="text-gray-600">No commander decks found.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {decks.map((deck) => (
        <DeckCard
          key={`${deck.code}-${deck.file_name}`}
          deck={deck}
        />
      ))}
    </div>
  )
}
