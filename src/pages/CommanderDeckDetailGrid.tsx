/**
 * Commander Deck Detail Grid Page
 *
 * Shows deck cards in a visual grid layout with images.
 * Queries v_commander_deck_card_details view directly.
 * Matches the original ManaMargin DeckDetail implementation.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, queryWithRetry } from '../services/supabase'

interface DeckCard {
  code: string
  deck_name: string
  card_name: string
  count: number
  is_commander: boolean
  is_foil: boolean
  price: number
  total_price: number
  uuid: string
  tcgplayer_product_id: string
  scryfall_id: string | null
  image_url: string | null
}

type FilterTab = 'all' | '25c' | '1d'

export const CommanderDeckDetailGrid: React.FC = () => {
  const { code, fileName } = useParams<{ code: string; fileName: string }>()
  const navigate = useNavigate()
  const [cards, setCards] = useState<DeckCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  const loadCards = async () => {
    if (!code || !fileName) return
    setIsLoading(true)
    setError(null)

    try {
      const { data, error } = await queryWithRetry(
        () => supabase
          .from('v_commander_deck_card_details')
          .select('*')
          .eq('code', code)
          .eq('deck_name', fileName)
          .order('price', { ascending: false, nullsFirst: false }),
        2,
        1500,
      )

      if (error) throw new Error(error.message)
      setCards(data ?? [])
    } catch (err: any) {
      setError(err.message || 'Failed to load deck details')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCards()
  }, [code, fileName])

  const filteredCards = useMemo(() => {
    if (activeTab === '25c') return cards.filter(c => (c.price || 0) >= 0.25)
    if (activeTab === '1d') return cards.filter(c => (c.price || 0) >= 1.00)
    return cards
  }, [cards, activeTab])

  if (isLoading) {
    return (
      <div className="p-20 flex flex-col items-center justify-center space-y-4 animate-pulse">
        <div className="w-12 h-12 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin"></div>
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-2)]">
          Loading Cards...
        </div>
      </div>
    )
  }

  if (error) {
    const isTimeout = error.toLowerCase().includes('timeout') || error.toLowerCase().includes('canceling statement')
    return (
      <div className="p-8 sm:p-12 flex flex-col items-center justify-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isTimeout ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            )}
          </svg>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-bold text-[var(--text-1)]">
            {isTimeout ? 'Request Timed Out' : 'Failed to Load'}
          </p>
          <p className="text-xs text-[var(--text-2)] max-w-xs">
            {isTimeout
              ? 'The database took too long to respond. This can happen during heavy load — try again.'
              : error}
          </p>
        </div>
        <button
          onClick={loadCards}
          className="px-5 py-2 bg-[var(--brand)] hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="w-full animate-fade-in space-y-4">
      <div className="bg-[#0f111a]/80 backdrop-blur-xl p-6 rounded-xl border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/commander-decks')}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-2)] hover:text-[var(--text-1)]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-1)]">{fileName}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded font-mono text-[var(--text-2)]">
                  {code}
                </span>
                <span className="text-[10px] font-bold text-[var(--text-2)]">
                  {cards.length} cards
                </span>
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            {[
              { id: 'all', label: 'All' },
              { id: '25c', label: '>$0.25' },
              { id: '1d', label: '>$1.00' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as FilterTab)}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                  activeTab === tab.id
                    ? 'bg-[var(--brand)] text-white shadow-lg shadow-blue-500/20'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Card Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredCards.map((card) => (
            <div
              key={card.uuid}
              className="flex flex-col bg-black/40 rounded-xl border border-white/5 overflow-hidden group hover:border-[var(--brand)]/30 hover:bg-blue-500/[0.02] transition-all shadow-lg"
            >
              {/* Card Image */}
              <div className="aspect-[3/4] relative overflow-hidden bg-black/20">
                {card.image_url ? (
                  <img
                    src={card.image_url}
                    alt={card.card_name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-2)] text-[10px] uppercase font-bold text-center p-4">
                    Image Not Found
                  </div>
                )}

                {/* Card Count Badge */}
                {card.count > 1 && (
                  <div className="absolute top-2 right-2 bg-[var(--brand)] text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow-lg z-10">
                    x{card.count}
                  </div>
                )}

                {/* Commander Badge */}
                {card.is_commander && (
                  <div className="absolute top-2 left-2 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow-lg z-10 uppercase tracking-tighter">
                    Cmdr
                  </div>
                )}

                {/* Hover Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              </div>

              {/* Card Info */}
              <div className="p-2.5 space-y-1 bg-gradient-to-b from-transparent to-black/20">
                <h3
                  className="text-[11px] font-bold text-[var(--text-1)] truncate group-hover:text-[var(--brand)] transition-colors"
                  title={card.card_name}
                >
                  {card.card_name}
                </h3>
                <div className="flex justify-between items-center">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                      card.is_foil
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-white/5 text-[var(--text-2)] border border-white/5'
                    }`}
                  >
                    {card.is_foil ? 'Foil' : 'Normal'}
                  </span>
                  <span className="font-black font-mono text-[var(--accent)] text-xs">
                    ${card.price ? card.price.toFixed(2) : '0.00'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* No Cards Message */}
        {filteredCards.length === 0 && (
          <div className="py-20 text-center text-[var(--text-2)] font-bold uppercase tracking-widest text-xs opacity-50">
            No cards found in this price bracket.
          </div>
        )}
      </div>
    </div>
  )
}
