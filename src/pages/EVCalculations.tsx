/**
 * EV Calculations Page
 *
 * Displays expected value data alongside the best marketplace price.
 * Uses the v_ev_with_best_offers view which JOINs through canonical_products
 * for reliable matching instead of frontend fuzzy matching.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../services/supabase'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

// --- Types ---

interface EVRow {
  canonical_product_id: number
  set_name: string
  product_type: string
  set_type: string | null
  set_code: string
  botbox_product_name: string
  expected_value: number
  botbox_market_price: number | null
  ev_to_price_ratio: number | null
  calculation_timestamp: string | null
  botbox_fetched_at: string | null
  best_marketplace: string | null
  best_price: number | null
  best_shipping: number | null
  best_total: number | null
  best_url: string | null
  individual_deck_count: number | null
  individual_decks_matched: number | null
}

interface DeckOffer {
  deck_name: string
  price: number
  shipping: number
  total: number
  marketplace: string
  url: string
}

type SortKey = 'set_name' | 'product_type' | 'expected_value' | 'botbox_market_price' | 'ev_to_price_ratio' | 'best_total'
type SortDir = 'asc' | 'desc'

// --- Component ---

export const EVCalculations: React.FC = () => {
  const [evRows, setEvRows] = useState<EVRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir }>({ key: 'ev_to_price_ratio', dir: 'desc' })
  const [ratioFilter, setRatioFilter] = useState<'all' | 'above1' | 'above0.8' | 'ev_above_best'>('ev_above_best')
  const [deckPopup, setDeckPopup] = useState<{ setName: string; total: number; decks: DeckOffer[] } | null>(null)
  const [deckPopupLoading, setDeckPopupLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Fetch individual deck offers for a Commander Deck Set popup
  const openDeckPopup = useCallback(async (setName: string, total: number) => {
    setDeckPopupLoading(true)
    setDeckPopup({ setName, total, decks: [] })

    try {
      // Get individual deck canonical products for this set
      const { data: deckProducts } = await supabase
        .from('canonical_products')
        .select('id, product_type')
        .eq('set_name', setName)
        .not('product_type', 'in', '("Commander Deck","Commander Deck Set","Commander Deck Collector Edition","Commander Deck Case","Collector Booster Box","Booster Box","Bundle","Booster Pack")')

      const products = (deckProducts ?? []) as { id: number; product_type: string }[]
      if (products.length === 0) {
        setDeckPopup(null)
        return
      }

      // For each deck, find the best offer
      const deckOffers: DeckOffer[] = []
      for (const dp of products) {
        if (dp.product_type.length <= 5) continue
        const { data: offers } = await supabase
          .from('offers_current')
          .select('price, shipping, marketplace, url')
          .eq('canonical_product_id', dp.id)
          .eq('in_stock', true)
          .eq('is_sealed', true)
          .order('price', { ascending: true })
          .limit(1)

        const typedOffers = (offers ?? []) as { price: number; shipping: number | null; marketplace: string; url: string }[]
        if (typedOffers.length > 0) {
          const o = typedOffers[0]
          deckOffers.push({
            deck_name: dp.product_type,
            price: o.price,
            shipping: o.shipping || 0,
            total: o.price + (o.shipping || 0),
            marketplace: o.marketplace,
            url: o.url,
          })
        }
      }

      setDeckPopup({ setName, total, decks: deckOffers })
    } catch {
      setDeckPopup(null)
    } finally {
      setDeckPopupLoading(false)
    }
  }, [])

  // Fetch data from unified view
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data, error: queryError } = await supabase
        .from('v_ev_with_best_offers')
        .select('*')
        .order('ev_to_price_ratio', { ascending: false, nullsFirst: false })
        .limit(2000)

      if (queryError) throw queryError
      setEvRows((data as EVRow[]) || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load EV data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Sorting
  const requestSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  const renderSortArrow = (key: SortKey) => {
    if (sortConfig.key !== key) return <span className="w-3 inline-block"></span>
    return <span className="ml-1 text-[10px] w-3 inline-block">{sortConfig.dir === 'asc' ? '\u25B2' : '\u25BC'}</span>
  }

  // Filtered and sorted data
  const displayRows = useMemo(() => {
    let filtered = evRows

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(r =>
        r.set_name.toLowerCase().includes(term) ||
        r.product_type.toLowerCase().includes(term) ||
        r.botbox_product_name.toLowerCase().includes(term) ||
        r.set_code.toLowerCase().includes(term)
      )
    }

    // Ratio filter
    if (ratioFilter === 'above1') {
      filtered = filtered.filter(r => r.ev_to_price_ratio !== null && r.ev_to_price_ratio >= 1)
    } else if (ratioFilter === 'above0.8') {
      filtered = filtered.filter(r => r.ev_to_price_ratio !== null && r.ev_to_price_ratio >= 0.8)
    } else if (ratioFilter === 'ev_above_best') {
      filtered = filtered.filter(r =>
        r.expected_value !== null && r.best_total !== null && r.expected_value > r.best_total
      )
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any

      if (sortConfig.key === 'set_name') {
        aVal = a.set_name.toLowerCase()
        bVal = b.set_name.toLowerCase()
      } else if (sortConfig.key === 'product_type') {
        aVal = a.product_type.toLowerCase()
        bVal = b.product_type.toLowerCase()
      } else if (sortConfig.key === 'best_total') {
        aVal = a.best_total ?? Infinity
        bVal = b.best_total ?? Infinity
      } else {
        aVal = a[sortConfig.key] ?? -Infinity
        bVal = b[sortConfig.key] ?? -Infinity
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortConfig.dir === 'asc' ? (aVal - bVal) : (bVal - aVal)
    })

    return filtered
  }, [evRows, searchTerm, ratioFilter, sortConfig])

  // Ratio color helper
  const ratioColor = (ratio: number | null) => {
    if (ratio === null) return 'text-[var(--text-2)]'
    if (ratio >= 1.2) return 'text-[var(--color-positive)]'
    if (ratio >= 1.0) return 'text-[var(--color-buy)]'
    if (ratio >= 0.8) return 'text-[var(--color-ref)]'
    return 'text-[var(--color-negative)]'
  }

  if (isLoading) {
    return (
      <div className="w-full animate-fade-in space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-1)]">EV Calculations</h1>
        <LoadingSpinner size="lg" text="Loading EV data..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full animate-fade-in space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-1)]">EV Calculations</h1>
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-6 rounded-xl text-center">
          <p className="font-bold">{error}</p>
          <button onClick={loadData} className="mt-4 px-8 py-2 bg-[var(--brand)] rounded-lg hover:bg-blue-600 text-white text-sm font-bold">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full animate-fade-in space-y-6">
      {/* Header */}
      <div className="bg-[var(--bg-surface)] backdrop-blur-xl p-6 rounded-xl border border-[var(--border-color)] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-1)]">EV Calculations</h2>
            <p className="text-sm text-[var(--text-2)] mt-1 hidden sm:block">
              Expected value analysis for sealed products. Products with EV/Price ratio above 1.0 are worth more than their market price.
            </p>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg bg-[var(--bg-hover)] border border-[var(--border-color)] hover:bg-[var(--bg-hover-2)] transition-colors text-[var(--text-2)]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {(searchTerm || ratioFilter !== 'ev_above_best') && (
              <span className="w-2 h-2 rounded-full bg-[var(--brand)]" />
            )}
          </button>
        </div>

        <div className={`${showFilters ? 'grid' : 'hidden'} md:grid grid-cols-1 sm:grid-cols-3 gap-4`}>
          {/* Search */}
          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase mb-2">Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Set name or product..."
              className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
            />
          </div>

          {/* Ratio Filter */}
          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase mb-2">EV/Price Ratio</label>
            <select
              value={ratioFilter}
              onChange={(e) => {
                setRatioFilter(e.target.value as any)
                setShowFilters(false)
              }}
              className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All</option>
              <option value="ev_above_best">EV &gt; Best Price</option>
              <option value="above1">Ratio Above 1.0</option>
              <option value="above0.8">Ratio Above 0.8</option>
            </select>
          </div>

          {/* Stats */}
          <div className="flex items-end">
            <div className="text-sm text-[var(--text-2)]">
              <span className="font-bold text-[var(--text-1)]">{displayRows.length}</span> products
              {searchTerm && ` matching "${searchTerm}"`}
            </div>
          </div>
        </div>
      </div>

      {/* Table — desktop */}
      <div className="hidden md:block bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[var(--bg-2)]/80 text-[var(--text-2)] font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 border-b border-[var(--border-color-2)]">
              <tr>
                {([
                  ['Set', 'set_name'],
                  ['Product', 'product_type'],
                  ['Expected Value', 'expected_value'],
                  ['Market Price', 'botbox_market_price'],
                  ['EV/Price', 'ev_to_price_ratio'],
                  ['Best Price', 'best_total'],
                ] as [string, SortKey][]).map(([label, key]) => (
                  <th
                    key={key}
                    className="px-4 py-4 cursor-pointer hover:bg-[var(--bg-hover-2)] transition-colors select-none whitespace-nowrap"
                    onClick={() => requestSort(key)}
                  >
                    <div className={`flex items-center gap-1 ${['expected_value', 'botbox_market_price', 'ev_to_price_ratio', 'best_total'].includes(key) ? 'justify-end' : ''}`}>
                      {label}{renderSortArrow(key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayRows.length > 0 ? (
                displayRows.map((row, idx) => (
                  <tr key={`${row.canonical_product_id}-${idx}`} className="group hover:bg-[var(--bg-hover)] transition-colors">
                    <td className="px-4 py-3 text-[var(--text-1)] font-medium max-w-[200px] truncate" title={row.set_name}>
                      {row.set_name}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)] max-w-[250px] truncate" title={row.botbox_product_name}>
                      {row.product_type}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ev)] font-bold">
                      {row.expected_value !== null ? `$${row.expected_value.toFixed(2)}` : '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--text-2)]">
                      {row.botbox_market_price !== null ? `$${row.botbox_market_price.toFixed(2)}` : '\u2014'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${ratioColor(row.ev_to_price_ratio)}`}>
                      {row.ev_to_price_ratio !== null ? row.ev_to_price_ratio.toFixed(4) : '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.best_marketplace === 'Individual Decks' && row.best_total !== null ? (
                        <button
                          onClick={() => openDeckPopup(row.set_name, row.best_total!)}
                          className="inline-flex items-center gap-1.5 font-mono font-bold text-[var(--color-buy)] hover:text-[var(--color-buy)] transition-colors cursor-pointer"
                          title={`$${row.best_total.toFixed(2)} total — click to see individual deck prices`}
                        >
                          ${row.best_total.toFixed(2)}
                          <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                          </svg>
                        </button>
                      ) : row.best_url ? (
                        <a
                          href={row.best_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono font-bold text-[var(--color-buy)] hover:text-[var(--color-buy)] transition-colors"
                          title={`Best price at ${row.best_marketplace}`}
                        >
                          <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          ${row.best_total!.toFixed(2)}
                        </a>
                      ) : (
                        <span className="text-[var(--text-2)] text-xs">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-[var(--text-2)]">
                    No products match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {displayRows.length > 0 ? (
          displayRows.map((row, idx) => (
            <div key={`m-${row.canonical_product_id}-${idx}`} className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] p-4 space-y-3">
              {/* Set & Product */}
              <div>
                <div className="text-[var(--text-1)] font-medium text-sm">{row.set_name}</div>
                <div className="text-[var(--text-2)] text-xs">{row.product_type}</div>
              </div>
              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                  <div className="text-[var(--text-2)] uppercase text-[10px] tracking-wider mb-0.5">Expected Value</div>
                  <div className="font-mono text-[var(--color-ev)] font-bold">
                    {row.expected_value !== null ? `$${row.expected_value.toFixed(2)}` : '\u2014'}
                  </div>
                </div>
                <div className="bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                  <div className="text-[var(--text-2)] uppercase text-[10px] tracking-wider mb-0.5">Market Price</div>
                  <div className="font-mono text-[var(--text-2)]">
                    {row.botbox_market_price !== null ? `$${row.botbox_market_price.toFixed(2)}` : '\u2014'}
                  </div>
                </div>
                <div className="bg-[var(--bg-hover)] rounded-lg px-3 py-2">
                  <div className="text-[var(--text-2)] uppercase text-[10px] tracking-wider mb-0.5">Best Price</div>
                  <div>
                    {row.best_marketplace === 'Individual Decks' && row.best_total !== null ? (
                      <button
                        onClick={() => openDeckPopup(row.set_name, row.best_total!)}
                        className="font-mono font-bold text-[var(--color-buy)] hover:text-[var(--color-buy)] transition-colors"
                      >
                        ${row.best_total.toFixed(2)}
                      </button>
                    ) : row.best_url ? (
                      <a
                        href={row.best_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono font-bold text-[var(--color-buy)] hover:text-[var(--color-buy)] transition-colors"
                      >
                        <svg className="w-3 h-3 opacity-60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        ${row.best_total!.toFixed(2)}
                      </a>
                    ) : (
                      <span className="text-[var(--text-2)]">{'\u2014'}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] px-4 py-16 text-center text-[var(--text-2)]">
            No products match your filters.
          </div>
        )}
      </div>

      {/* Data source footer */}
      {evRows.length > 0 && evRows[0].botbox_fetched_at && (
        <div className="text-center text-xs text-[var(--text-2)]">
          EV data last updated {new Date(evRows[0].botbox_fetched_at).toLocaleDateString()}
        </div>
      )}

      {/* Individual Deck Prices Popup */}
      {deckPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-sm" onClick={() => setDeckPopup(null)}>
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-1)]">{deckPopup.setName}</h3>
                <p className="text-xs text-[var(--text-2)]">Commander Deck Set — Individual Prices</p>
              </div>
              <button onClick={() => setDeckPopup(null)} className="text-[var(--text-2)] hover:text-white transition-colors p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {deckPopupLoading ? (
                <div className="py-8 text-center text-[var(--text-2)]">Loading deck prices...</div>
              ) : deckPopup.decks.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-2)]">No individual deck offers found.</div>
              ) : (
                deckPopup.decks.map((deck) => (
                  <a
                    key={deck.deck_name}
                    href={deck.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[var(--bg-hover-2)] border border-[var(--border-color-2)] transition-colors group"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--text-1)]">{deck.deck_name}</div>
                      <div className="text-xs text-[var(--text-2)]">{deck.marketplace}{deck.shipping > 0 ? ` (+$${deck.shipping.toFixed(2)} shipping)` : ''}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-[var(--text-2)] group-hover:text-[var(--color-buy)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="font-mono font-bold text-[var(--color-buy)]">${deck.total.toFixed(2)}</span>
                    </div>
                  </a>
                ))
              )}
            </div>

            {!deckPopupLoading && deckPopup.decks.length > 0 && (
              <div className="px-6 py-3 border-t border-[var(--border-color)] flex items-center justify-between">
                <span className="text-sm text-[var(--text-2)]">{deckPopup.decks.length} decks</span>
                <span className="font-mono font-bold text-[var(--color-buy)]">
                  Total: ${deckPopup.decks.reduce((sum, d) => sum + d.total, 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
