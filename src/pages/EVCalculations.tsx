/**
 * EV Calculations Page
 *
 * Displays expected value data from BotBox alongside the best marketplace price.
 * Shows set, product type, EV, market price, EV/price ratio, and a link to the best deal.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../services/supabase'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

// --- Types ---

interface EVRow {
  set_code: string
  set_name: string | null
  product_name: string
  expected_value: number | null
  market_price: number | null
  ev_to_price_ratio: number | null
  calculation_timestamp: string | null
  fetched_at: string | null
}

interface BestOffer {
  total: number
  url: string
  marketplace: string
}

type SortKey = 'set_name' | 'product_name' | 'expected_value' | 'market_price' | 'ev_to_price_ratio' | 'best_price'
type SortDir = 'asc' | 'desc'

// --- Component ---

export const EVCalculations: React.FC = () => {
  const [evRows, setEvRows] = useState<EVRow[]>([])
  const [bestOffers, setBestOffers] = useState<Map<string, BestOffer>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir }>({ key: 'ev_to_price_ratio', dir: 'desc' })
  const [ratioFilter, setRatioFilter] = useState<'all' | 'above1' | 'above0.8' | 'ev_above_best'>('all')

  // Fetch EV data from BotBox table
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data, error: evError } = await supabase
        .from('botbox_ev_calculations')
        .select('set_code,set_name,product_name,expected_value,market_price,ev_to_price_ratio,calculation_timestamp,fetched_at')
        .not('expected_value', 'is', null)
        .order('ev_to_price_ratio', { ascending: false, nullsFirst: false })
        .limit(2000)

      if (evError) throw evError
      setEvRows((data as EVRow[]) || [])

      // Fetch best marketplace prices for matching products
      // We query the offers MV grouped by set_name + product_type to get the lowest total
      const { data: offersData, error: offersError } = await supabase
        .from('offers_latest_enriched_mv')
        .select('set_name,product_type,price,shipping,url,marketplace')
        .eq('in_stock', true)
        .not('product_type', 'is', null)
        .order('price', { ascending: true })
        .limit(5000)

      if (!offersError && offersData) {
        const offerMap = new Map<string, BestOffer>()
        for (const offer of offersData as any[]) {
          const setName = (offer.set_name || '').toLowerCase()
          const productType = (offer.product_type || '').toLowerCase()
          const key = `${setName}|${productType}`
          const total = (parseFloat(String(offer.price)) || 0) + (parseFloat(String(offer.shipping ?? 0)) || 0)
          const existing = offerMap.get(key)
          if (!existing || total < existing.total) {
            offerMap.set(key, { total, url: offer.url, marketplace: offer.marketplace })
          }
        }
        setBestOffers(offerMap)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load EV data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Match a BotBox product_name to the best offer
  const findBestOffer = useCallback((setName: string | null, productName: string): BestOffer | null => {
    if (!setName) return null
    const sn = setName.replace(/\s*\([A-Z0-9]+\)\s*$/, '').toLowerCase().trim()
    const pn = productName.toLowerCase()

    // Try each offer key and see if the BotBox product_name contains the offer's product_type
    for (const [key, offer] of bestOffers) {
      const [offerSet, offerType] = key.split('|')
      if (!offerType) continue
      if (!sn.includes(offerSet) && !offerSet.includes(sn)) continue
      if (pn.includes(offerType)) return offer
    }
    return null
  }, [bestOffers])

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
        (r.set_name || '').toLowerCase().includes(term) ||
        r.product_name.toLowerCase().includes(term) ||
        r.set_code.toLowerCase().includes(term)
      )
    }

    // Ratio filter
    if (ratioFilter === 'above1') {
      filtered = filtered.filter(r => r.ev_to_price_ratio !== null && r.ev_to_price_ratio >= 1)
    } else if (ratioFilter === 'above0.8') {
      filtered = filtered.filter(r => r.ev_to_price_ratio !== null && r.ev_to_price_ratio >= 0.8)
    } else if (ratioFilter === 'ev_above_best') {
      filtered = filtered.filter(r => {
        if (!r.expected_value) return false
        const offer = findBestOffer(r.set_name, r.product_name)
        return offer !== null && r.expected_value > offer.total
      })
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any

      if (sortConfig.key === 'best_price') {
        const aOffer = findBestOffer(a.set_name, a.product_name)
        const bOffer = findBestOffer(b.set_name, b.product_name)
        aVal = aOffer?.total ?? Infinity
        bVal = bOffer?.total ?? Infinity
      } else if (sortConfig.key === 'set_name') {
        aVal = (a.set_name || '').toLowerCase()
        bVal = (b.set_name || '').toLowerCase()
      } else if (sortConfig.key === 'product_name') {
        aVal = a.product_name.toLowerCase()
        bVal = b.product_name.toLowerCase()
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
  }, [evRows, searchTerm, ratioFilter, sortConfig, findBestOffer])

  // Ratio color helper
  const ratioColor = (ratio: number | null) => {
    if (ratio === null) return 'text-[var(--text-2)]'
    if (ratio >= 1.2) return 'text-green-400'
    if (ratio >= 1.0) return 'text-emerald-400'
    if (ratio >= 0.8) return 'text-yellow-400'
    return 'text-red-400'
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
      <div className="bg-[#0f111a]/80 backdrop-blur-xl p-6 rounded-xl border border-white/10 shadow-2xl">
        <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-1)] mb-4">EV Calculations</h2>
        <p className="text-sm text-[var(--text-2)] mb-4">
          Expected value data from BotBox. Products with EV/Price ratio above 1.0 are worth more than their market price.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              onChange={(e) => setRatioFilter(e.target.value as any)}
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

      {/* Table */}
      <div className="bg-[#0f111a]/80 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[var(--bg-2)]/80 text-[var(--text-2)] font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 border-b border-white/5">
              <tr>
                {([
                  ['Set', 'set_name'],
                  ['Product', 'product_name'],
                  ['Expected Value', 'expected_value'],
                  ['Market Price', 'market_price'],
                  ['EV/Price', 'ev_to_price_ratio'],
                  ['Best Price', 'best_price'],
                ] as [string, SortKey][]).map(([label, key]) => (
                  <th
                    key={key}
                    className="px-4 py-4 cursor-pointer hover:bg-white/10 transition-colors select-none whitespace-nowrap"
                    onClick={() => requestSort(key)}
                  >
                    <div className={`flex items-center gap-1 ${['expected_value', 'market_price', 'ev_to_price_ratio', 'best_price'].includes(key) ? 'justify-end' : ''}`}>
                      {label}{renderSortArrow(key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayRows.length > 0 ? (
                displayRows.map((row, idx) => {
                  const offer = findBestOffer(row.set_name, row.product_name)
                  const setDisplay = (row.set_name || row.set_code).replace(/\s*\([A-Z0-9]+\)\s*$/, '')
                  return (
                    <tr key={`${row.set_code}-${row.product_name}-${idx}`} className="group hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3 text-[var(--text-1)] font-medium max-w-[200px] truncate" title={row.set_name || row.set_code}>
                        {setDisplay}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-2)] max-w-[250px] truncate" title={row.product_name}>
                        {row.product_name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-purple-400 font-bold">
                        {row.expected_value !== null ? `$${row.expected_value.toFixed(2)}` : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--text-2)]">
                        {row.market_price !== null ? `$${row.market_price.toFixed(2)}` : '\u2014'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${ratioColor(row.ev_to_price_ratio)}`}>
                        {row.ev_to_price_ratio !== null ? row.ev_to_price_ratio.toFixed(4) : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {offer ? (
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-mono font-bold text-green-400 hover:text-green-300 transition-colors"
                            title={`Best price at ${offer.marketplace}`}
                          >
                            ${offer.total.toFixed(2)}
                            <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-[var(--text-2)] text-xs">{'\u2014'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })
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

      {/* Data source footer */}
      {evRows.length > 0 && evRows[0].fetched_at && (
        <div className="text-center text-xs text-[var(--text-2)]">
          EV data from BotBox · Last updated {new Date(evRows[0].fetched_at).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}
