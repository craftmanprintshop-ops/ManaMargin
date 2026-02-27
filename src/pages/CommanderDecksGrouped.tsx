/**
 * Commander Decks Grouped Page
 *
 * Shows commander decks grouped by set with value breakdowns.
 * Queries v_commander_deck_values view directly (snake_case fields).
 * Matches the original ManaMargin implementation.
 */

import React, { useEffect, useState, useMemo } from 'react'
import { supabase, queryWithRetry } from '../services/supabase'
import { useInventory } from '../hooks/useInventory'
import { CheckEbayButton } from '../components/common/CheckEbayButton'

interface CommanderDeckValue {
  code: string
  set_name: string | null
  deck_name: string
  release_date: string
  card_count: number
  cards_with_prices: number
  total_value: number
  value_over_25c: number
  value_over_1: number
  cards_over_25c: number
  cards_over_1: number
}

interface PriceOffer {
  id: string
  marketplace: string
  title: string
  price: number
  shipping: number | null
  in_stock: boolean
  url: string
}

interface CheapestOffer {
  price: number
  marketplace: string
  url: string
}

interface MtgstocksPrice {
  avg_price: number | null
  market_price: number | null
  url: string | null
}

interface EVData {
  expected_value: number
  ev_to_price_ratio: number | null
  best_total: number | null
}

// --- Price Popup Modal ---
const PricePopup: React.FC<{ deck: CommanderDeckValue; onClose: () => void; mtgstocksPrice?: MtgstocksPrice | null }> = ({ deck, onClose, mtgstocksPrice }) => {
  const [offers, setOffers] = useState<PriceOffer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [popupError, setPopupError] = useState<string | null>(null)

  const loadPrices = async () => {
    setIsLoading(true)
    setPopupError(null)
    try {
      const { data, error } = await queryWithRetry(
        () => {
          let q = supabase
            .from('offers_latest_enriched_mv')
            .select('id,marketplace,title,price,shipping,in_stock,url')
            .eq('product_type', 'Commander Deck')

          if (deck.set_name) {
            q = q.eq('set_name', deck.set_name)
          }

          return q.ilike('title', `%${deck.deck_name}%`)
            .order('price', { ascending: true })
            .limit(20)
        },
        2,
        1500,
      )

      if (error) throw error

      setOffers((data ?? []).map((o: any) => ({
        ...o,
        price: parseFloat(String(o.price ?? '0')) || 0,
        shipping: o.shipping === null ? null : (parseFloat(String(o.shipping ?? '0')) || 0),
      })))
    } catch (err: any) {
      const msg = err?.message || 'Failed to load prices'
      setPopupError(msg)
      console.error('Failed to load prices:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPrices()
  }, [deck])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-overlay)] backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-hover)]">
          <div>
            <h3 className="font-bold text-[var(--text-1)] text-lg">{deck.deck_name}</h3>
            <div className="flex items-center gap-3">
              <p className="text-xs text-[var(--text-2)]">{deck.set_name || deck.code.toUpperCase()}</p>
              {mtgstocksPrice && (mtgstocksPrice.market_price || mtgstocksPrice.avg_price) && (
                <a
                  href={mtgstocksPrice.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold text-[var(--color-ref)] bg-[var(--color-ref)]/10 px-2 py-0.5 rounded border border-[var(--color-ref)]/20 hover:bg-[var(--color-ref)]/20 transition-colors"
                >
                  Market: ${(mtgstocksPrice.market_price ?? mtgstocksPrice.avg_price)?.toFixed(2)}
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-hover-2)] rounded-full text-[var(--text-2)] transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Offers List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-10 h-10 border-3 border-[var(--brand)] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-black">Checking Markets...</p>
            </div>
          ) : popupError ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <svg className="w-10 h-10 text-red-400 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-[var(--text-2)]">Request timed out</p>
              <button
                onClick={loadPrices}
                className="px-4 py-1.5 bg-[var(--brand)] hover:bg-[var(--primary-700)] text-white text-xs font-bold rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : offers.length > 0 ? (
            <div className="space-y-3">
              {offers.map((offer) => (
                <a
                  key={offer.id}
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between p-4 bg-[var(--bg-hover)] border border-[var(--border-color-2)] rounded-xl hover:border-[var(--brand)] hover:bg-[var(--bg-hover-2)] transition-all group/offer ${!offer.in_stock ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-[var(--bg-surface-2)] flex items-center justify-center border border-[var(--border-color)]">
                      <svg className="w-5 h-5 text-[var(--color-buy)] opacity-70 group-hover/offer:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-black tracking-widest text-[var(--text-2)] mb-0.5">
                        {offer.marketplace}
                      </div>
                      <div className="text-[var(--text-1)] font-bold text-sm truncate max-w-[240px]">
                        {offer.title}
                      </div>
                      {!offer.in_stock && (
                        <span className="text-[9px] text-red-400 font-bold uppercase">Out of Stock</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--color-value)] font-black font-mono text-lg leading-none">
                      ${offer.price.toFixed(2)}
                    </div>
                    {offer.shipping !== null && (
                      <div className="text-[10px] text-[var(--text-2)] mt-1">
                        + ${offer.shipping.toFixed(2)} shipping
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center">
              <svg className="w-12 h-12 mx-auto text-[var(--text-2)] opacity-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-[var(--text-2)] text-sm">No marketplace offers found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] text-center">
          <p className="text-[10px] text-[var(--text-2)] uppercase tracking-widest font-black opacity-40">
            Real-time Marketplace Comparison
          </p>
        </div>
      </div>
    </div>
  )
}

// --- Main Component ---

interface CommanderDecksGroupedProps {
  onDeckSelect: (code: string, deckName: string) => void
}

type DeckFilter = 'all' | 'deals'

export const CommanderDecksGrouped: React.FC<CommanderDecksGroupedProps> = ({ onDeckSelect }) => {
  const { isInInventory, toggleItem } = useInventory()
  const [decks, setDecks] = useState<CommanderDeckValue[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPriceDeck, setSelectedPriceDeck] = useState<CommanderDeckValue | null>(null)
  const [cheapestOffers, setCheapestOffers] = useState<Map<string, CheapestOffer>>(new Map())
  const [mtgstocksPrices, setMtgstocksPrices] = useState<Map<string, MtgstocksPrice>>(new Map())
  const [evData, setEvData] = useState<Map<string, EVData>>(new Map())
  const [activeFilter, setActiveFilter] = useState<DeckFilter>('all')

  const loadDecks = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, error, attempts } = await queryWithRetry(
        () => supabase
          .from('v_commander_deck_values')
          .select('*')
          .order('release_date', { ascending: false }),
        2,  // 2 retries = 3 total attempts
        1500,
      )

      if (error) throw new Error(error.message)
      if (attempts > 1) console.log(`Commander decks loaded after ${attempts} attempts`)

      // Resolve set names from cards table for any decks missing set_name
      const rows = (data ?? []) as any[]
      const codesNeedingNames = [...new Set(rows.filter(d => !d.set_name).map(d => d.code))]
      if (codesNeedingNames.length > 0) {
        const { data: cardRows } = await supabase
          .from('cards')
          .select('set_code, set_name')
          .in('set_code', codesNeedingNames)
          .not('set_name', 'is', null)
          .limit(1000)
        const nameMap = new Map<string, string>()
        ;(cardRows as any[] ?? []).forEach((c: any) => {
          if (c.set_name && !nameMap.has(c.set_code)) nameMap.set(c.set_code, c.set_name)
        })
        rows.forEach(d => {
          if (!d.set_name && nameMap.has(d.code)) d.set_name = nameMap.get(d.code)
        })
      }

      const sorted = [...rows].sort((a: any, b: any) => {
        const dateCompare = new Date(b.release_date).getTime() - new Date(a.release_date).getTime()
        if (dateCompare !== 0) return dateCompare
        return (a.set_name || '').localeCompare(b.set_name || '')
      })

      setDecks(sorted)
    } catch (err: any) {
      setError(err.message || 'Failed to load commander decks')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDecks()
  }, [])

  // Load cheapest marketplace offers for all commander decks in one query
  useEffect(() => {
    if (decks.length === 0) return

    const loadCheapest = async () => {
      try {
        const { data, error } = await queryWithRetry(
          () => supabase
            .from('offers_latest_enriched_mv')
            .select('title,marketplace,price,url,in_stock,set_name')
            .in('product_type', ['Commander Deck', 'Commander Deck Set'])
            .eq('in_stock', true)
            .order('price', { ascending: true })
            .limit(2000),
          2,
          1500,
        )

        if (error) throw error

        const offers = (data ?? []) as any[]

        // Build a map of cheapest set-level offers by set_name for fallback
        const setOfferMap = new Map<string, any>()
        for (const offer of offers) {
          const setName = (offer.set_name || '').toLowerCase()
          if (setName && !setOfferMap.has(setName)) {
            setOfferMap.set(setName, offer)
          }
        }

        // Match offers to deck names
        const offerMap = new Map<string, CheapestOffer>()
        for (const deck of decks) {
          const deckKey = `${deck.code}|${deck.deck_name}`
          if (offerMap.has(deckKey)) continue

          const nameLower = deck.deck_name.toLowerCase()

          // 1. Try exact deck name match in title
          let match = offers.find((o) => {
            const titleLower = (o.title || '').toLowerCase()
            return titleLower.includes(nameLower)
          })

          // 2. Fallback: match by set_name on the offer
          if (!match && deck.set_name) {
            // Strip "Commander" suffix from set_name for matching (e.g. "Lorwyn Eclipsed Commander" -> "Lorwyn Eclipsed")
            const baseSetName = deck.set_name.replace(/\s+Commander$/i, '').toLowerCase()
            match = setOfferMap.get(baseSetName) || setOfferMap.get(deck.set_name.toLowerCase())
          }

          if (match) {
            offerMap.set(deckKey, {
              price: parseFloat(String(match.price ?? '0')) || 0,
              marketplace: match.marketplace,
              url: match.url,
            })
          }
        }

        setCheapestOffers(offerMap)
      } catch (err) {
        console.error('Failed to load cheapest offers:', err)
      }
    }
    loadCheapest()
  }, [decks])

  // Load MTGStocks sealed prices for commander decks
  useEffect(() => {
    if (decks.length === 0) return

    const loadMtgstocksPrices = async () => {
      try {
        // Get all MTGStocks products from commander-related sets
        const { data, error } = await queryWithRetry(
          () => supabase
            .from('v_mtgstocks_sealed_latest')
            .select('set_name,product_name,avg_price,market_price,url')
            .ilike('set_name', 'Commander:%')
            .order('avg_price', { ascending: false, nullsFirst: false })
            .limit(2000),
          2,
          1500,
        )

        if (error) throw error

        // Match MTGStocks products to commander decks by deck name
        const priceMap = new Map<string, MtgstocksPrice>()
        for (const deck of decks) {
          const deckKey = `${deck.code}|${deck.deck_name}`
          if (priceMap.has(deckKey)) continue

          const deckNameLower = deck.deck_name.toLowerCase()
          const match = (data ?? []).find((p: any) => {
            const productLower = (p.product_name || '').toLowerCase()
            return productLower === deckNameLower || productLower.includes(deckNameLower) || deckNameLower.includes(productLower)
          })

          if (match) {
            const mtgMatch = match as any
            priceMap.set(deckKey, {
              avg_price: mtgMatch.avg_price ? parseFloat(String(mtgMatch.avg_price)) : null,
              market_price: mtgMatch.market_price ? parseFloat(String(mtgMatch.market_price)) : null,
              url: mtgMatch.url,
            })
          }
        }

        setMtgstocksPrices(priceMap)
      } catch (err) {
        console.error('Failed to load MTGStocks prices:', err)
      }
    }
    loadMtgstocksPrices()
  }, [decks])

  // Load EV data for commander deck sets
  useEffect(() => {
    const loadEvData = async () => {
      try {
        const { data, error } = await supabase
          .from('v_ev_with_best_offers')
          .select('set_name, product_type, expected_value, ev_to_price_ratio, best_total')
          .not('expected_value', 'is', null)
          .limit(500)

        if (error || !data) return

        const evMap = new Map<string, EVData>()
        for (const row of data as any[]) {
          // Key by set_name|product_type so we can match both set-level and individual decks
          const key = `${row.set_name}|${row.product_type}`
          evMap.set(key, {
            expected_value: row.expected_value,
            ev_to_price_ratio: row.ev_to_price_ratio,
            best_total: row.best_total,
          })
        }
        setEvData(evMap)
      } catch {
        // silent
      }
    }
    loadEvData()
  }, [])

  const groupedDecks = useMemo(() => {
    const groups: { [key: string]: CommanderDeckValue[] } = {}
    decks.forEach(deck => {
      // Skip Secret Lair sets if set_name is populated
      if (deck.set_name && deck.set_name.toLowerCase().includes('secret lair')) return

      // Apply "deals" filter: market price < value_over_25c
      if (activeFilter === 'deals') {
        const deckKey = `${deck.code}|${deck.deck_name}`
        const cheapest = cheapestOffers.get(deckKey)
        if (!cheapest || cheapest.price >= (deck.value_over_25c || 0)) return
      }

      const displayName = deck.set_name || deck.code.toUpperCase()
      const isCollectorDeck = deck.deck_name.toLowerCase().includes('collector')
      const isCollectorSet = displayName.toLowerCase().includes('collector')
      const groupType = (isCollectorDeck || isCollectorSet) ? 'collector' : 'normal'
      const key = `${deck.release_date}_${deck.code}_${groupType}`
      if (!groups[key]) groups[key] = []
      groups[key].push(deck)
    })
    return groups
  }, [decks, activeFilter, cheapestOffers])

  const dealCount = useMemo(() => {
    let count = 0
    decks.forEach(deck => {
      if (deck.set_name && deck.set_name.toLowerCase().includes('secret lair')) return
      const deckKey = `${deck.code}|${deck.deck_name}`
      const cheapest = cheapestOffers.get(deckKey)
      if (cheapest && cheapest.price < (deck.value_over_25c || 0)) count++
    })
    return count
  }, [decks, cheapestOffers])

  if (isLoading) {
    return (
      <div className="p-20 flex flex-col items-center justify-center space-y-4 animate-pulse">
        <div className="w-12 h-12 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin"></div>
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-2)]">
          Loading Decks...
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
          onClick={loadDecks}
          className="px-5 py-2 bg-[var(--brand)] hover:bg-[var(--primary-700)] text-white text-sm font-bold rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="w-full animate-fade-in space-y-4">
      {/* Price Popup Modal */}
      {selectedPriceDeck && (
        <PricePopup
          deck={selectedPriceDeck}
          onClose={() => setSelectedPriceDeck(null)}
          mtgstocksPrice={mtgstocksPrices.get(`${selectedPriceDeck.code}|${selectedPriceDeck.deck_name}`) ?? null}
        />
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-[var(--bg-inset)] p-1 rounded-xl border border-[var(--border-color-2)]">
          {[
            { id: 'all' as DeckFilter, label: 'All Decks' },
            { id: 'deals' as DeckFilter, label: `Deals`, count: dealCount },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-2 ${
                activeFilter === tab.id
                  ? 'bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand)]/20'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${
                  activeFilter === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--color-buy-bg)] text-[var(--color-buy)]'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {activeFilter === 'deals' && (
          <span className="text-[10px] text-[var(--text-2)] opacity-60">
            Market price &lt; card value (&gt;$0.25)
          </span>
        )}
      </div>

      <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[var(--bg-surface-2)] text-[var(--text-2)] font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 border-b border-[var(--border-color-2)]">
              <tr>
                <th className="px-3 sm:px-6 py-4">Set & Deck Name</th>
                <th className="px-3 sm:px-6 py-4 text-right text-[var(--color-value)]">Value</th>
                <th className="px-4 py-4 text-right text-[var(--color-ev)]">EV</th>
                <th className="px-4 py-4 text-right text-[var(--color-value)] hidden md:table-cell">&gt;$0.25</th>
                <th className="px-4 py-4 text-right text-[var(--color-value)]/60 hidden md:table-cell">&gt;$1.00</th>
                <th className="px-3 sm:px-4 py-4 text-right text-[var(--color-ref)] hidden lg:table-cell">Ref Price</th>
                <th className="px-3 sm:px-4 py-4 text-right text-[var(--color-buy)]">Market</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {Object.entries(groupedDecks).map(([groupKey, groupDecks]) => {
                const first = groupDecks[0]
                const totalValue = groupDecks.reduce((sum, d) => sum + (d.total_value || 0), 0)
                const total25c = groupDecks.reduce((sum, d) => sum + (d.value_over_25c || 0), 0)
                const total1d = groupDecks.reduce((sum, d) => sum + (d.value_over_1 || 0), 0)

                return (
                  <React.Fragment key={groupKey}>
                    {/* Set Header Row */}
                    <tr className="bg-[var(--bg-set-row)] border-y border-[var(--border-color-2)]">
                      <td className="px-3 sm:px-6 py-2">
                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
                          <img
                            src={`https://svgs.scryfall.io/sets/${first.code.toLowerCase()}.svg`}
                            alt=""
                            className="w-5 h-5 invert opacity-70"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                          <span className="text-sm font-bold text-[var(--text-1)] tracking-tight">
                            {first.set_name || first.code.toUpperCase()}
                          </span>
                          {first.set_name && (
                            <span className="font-mono text-[var(--text-2)] bg-[var(--bg-hover)] px-2 py-0.5 rounded text-[10px] hidden sm:inline uppercase">
                              {first.code}
                            </span>
                          )}
                          <span className="text-[10px] text-[var(--text-2)] opacity-60 hidden sm:inline">
                            {first.release_date}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-2 text-right font-black font-mono text-[var(--color-value)] text-base sm:text-lg">
                        ${totalValue.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {(() => {
                          const setName = first.set_name || first.code.toUpperCase()
                          const setEv = evData.get(`${setName}|Commander Deck Set`)
                          if (!setEv) return null
                          return (
                            <span className="font-bold font-mono text-[var(--color-ev)] text-xs">
                              ${setEv.expected_value.toFixed(2)}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--color-value)]/80 text-xs hidden md:table-cell">
                        ${total25c.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[var(--color-value)]/60 text-xs hidden md:table-cell">
                        ${total1d.toFixed(2)}
                      </td>
                      <td className="px-3 sm:px-4 py-2 hidden lg:table-cell"></td>
                      <td className="px-3 sm:px-4 py-2"></td>
                    </tr>

                    {/* Individual Deck Rows */}
                    {groupDecks.map((deck) => {
                      const deckKey = `${deck.code}|${deck.deck_name}`
                      const cheapest = cheapestOffers.get(deckKey)

                      return (
                        <tr
                          key={`${deck.code}-${deck.deck_name}`}
                          className="group hover:bg-[var(--bg-row-hover)] transition-colors cursor-pointer"
                          onClick={() => onDeckSelect(deck.code, deck.deck_name)}
                        >
                          <td className="px-3 sm:px-6 py-3 sm:py-4">
                            <div className="flex items-center gap-2 sm:gap-3">
                              <span className="text-xs sm:text-sm font-bold text-[var(--text-1)] group-hover:text-[var(--brand)] transition-colors truncate">
                                {deck.deck_name}
                              </span>
                              <CheckEbayButton
                                query={`mtg ${deck.set_name || ''} ${deck.deck_name}`}
                                productLabel={`${deck.set_name || deck.code.toUpperCase()} ${deck.deck_name}`}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedPriceDeck(deck)
                                }}
                                className="p-1.5 hover:bg-[var(--bg-hover-2)] rounded-lg text-[var(--text-2)] hover:text-[var(--brand)] transition-all shrink-0"
                                title="Compare All Prices"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const setName = deck.set_name || deck.code.toUpperCase()
                                  toggleItem({
                                    setName,
                                    productType: 'Commander Deck',
                                    title: deck.deck_name,
                                    costPaid: cheapestOffers.get(deckKey)?.price || 0,
                                    count: 1,
                                    feePercent: 13,
                                    shippingCost: 5,
                                  })
                                }}
                                className="p-1.5 hover:bg-[var(--bg-hover-2)] rounded-lg transition-all shrink-0 hover:scale-110"
                                title={isInInventory(deck.set_name || deck.code.toUpperCase(), 'Commander Deck') ? 'Remove from inventory' : 'Add to inventory'}
                              >
                                <svg className="w-4 h-4" fill={isInInventory(deck.set_name || deck.code.toUpperCase(), 'Commander Deck') ? 'var(--brand)' : 'none'} stroke={isInInventory(deck.set_name || deck.code.toUpperCase(), 'Commander Deck') ? 'var(--brand)' : 'currentColor'} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-3 sm:py-4 text-right font-black font-mono text-[var(--color-value)] text-sm sm:text-base">
                            ${(deck.total_value || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 sm:py-4 text-right">
                            {(() => {
                              const setName = deck.set_name || deck.code.toUpperCase()
                              // Try exact deck name match, then Commander Deck generic
                              const deckEv = evData.get(`${setName}|${deck.deck_name}`)
                                || evData.get(`${setName}|Commander Deck`)
                              if (!deckEv) return <span className="text-[var(--text-2)] text-[10px] opacity-40">—</span>
                              return (
                                <span className="font-bold font-mono text-[var(--color-ev)] text-xs">
                                  ${deckEv.expected_value.toFixed(2)}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-[var(--color-value)]/80 text-xs hidden md:table-cell">
                            ${(deck.value_over_25c || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-[var(--color-value)]/60 text-xs hidden md:table-cell">
                            ${(deck.value_over_1 || 0).toFixed(2)}
                          </td>
                          <td className="px-2 sm:px-4 py-3 sm:py-4 text-right hidden lg:table-cell">
                            {(() => {
                              const mtgPrice = mtgstocksPrices.get(deckKey)
                              if (!mtgPrice) return <span className="text-[var(--text-2)] text-[10px] opacity-40">—</span>
                              const displayPrice = mtgPrice.market_price ?? mtgPrice.avg_price
                              if (!displayPrice) return <span className="text-[var(--text-2)] text-[10px] opacity-40">—</span>
                              return (
                                <a
                                  href={mtgPrice.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex flex-col items-end px-2 py-0.5 rounded-lg hover:bg-[var(--color-ref)]/10 transition-all group/mtg"
                                  title={`Avg $${mtgPrice.avg_price?.toFixed(2) ?? 'N/A'} / Market $${mtgPrice.market_price?.toFixed(2) ?? 'N/A'}`}
                                >
                                  <span className="font-bold font-mono text-[var(--color-ref)] text-xs">
                                    ${displayPrice.toFixed(2)}
                                  </span>
                                  {mtgPrice.avg_price && mtgPrice.market_price && (
                                    <span className="text-[9px] text-[var(--text-2)] opacity-60">
                                      avg ${mtgPrice.avg_price.toFixed(2)}
                                    </span>
                                  )}
                                </a>
                              )
                            })()}
                          </td>
                          <td className="px-2 sm:px-4 py-3 sm:py-4 text-right">
                            {cheapest ? (
                              <a
                                href={cheapest.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-[var(--color-buy-bg)] border border-[var(--color-buy-border)] hover:bg-[var(--color-buy-bg)] hover:border-[var(--color-buy-hover-border)] transition-all group/buy"
                                title={`Buy from ${cheapest.marketplace}`}
                              >
                                <svg className="w-3.5 h-3.5 text-[var(--color-buy)] opacity-60 group-hover/buy:opacity-100 transition-opacity shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                <span className="font-black font-mono text-[var(--color-buy)] text-xs sm:text-sm">
                                  ${cheapest.price.toFixed(2)}
                                </span>
                              </a>
                            ) : (
                              <span className="text-[var(--text-2)] text-[10px] opacity-40">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}
              {activeFilter === 'deals' && Object.keys(groupedDecks).length === 0 && (
                <tr>
                  <td colSpan={99} className="px-6 py-20 text-center">
                    <div className="text-[var(--text-2)] text-sm font-bold opacity-50">
                      No deals found — no decks have a market price below their &gt;$0.25 card value
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
