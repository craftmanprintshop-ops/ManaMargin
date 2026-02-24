/**
 * Inventory Page
 *
 * Track sealed products you own with cost basis, fees, and P/L calculations.
 * Search and add products from the MV, edit cost/count/fees inline.
 * MTGStocks average prices are fetched for valuation.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../services/supabase'
import type { InventoryItem } from '../hooks/useInventory'
import { useInventory } from '../hooks/useInventory'

interface SearchResult {
  set_name: string
  product_type: string
  title: string
  marketplace: string
  price: number
}

interface MtgstocksRef {
  normalized_product_type: string | null
  product_name: string | null
  avg_price: number | null
  market_price: number | null
}

export const Inventory: React.FC = () => {
  const { items, addItem, removeItem, updateItem } = useInventory()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // MTGStocks prices keyed by "setName|productType"
  const [mtgPrices, setMtgPrices] = useState<Map<string, number>>(new Map())

  // Search for sealed products
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (query.trim().length < 2) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const { data, error } = await supabase
        .from('offers_latest_enriched_mv')
        .select('set_name,product_type,title,marketplace,price')
        .not('product_type', 'is', null)
        .not('set_name', 'is', null)
        .or(`set_name.ilike.%${query}%,title.ilike.%${query}%,product_type.ilike.%${query}%`)
        .order('set_name')
        .limit(100)

      if (error) throw error

      // Deduplicate by set_name + product_type, keep cheapest
      const seen = new Map<string, SearchResult>()
      for (const row of (data ?? []) as any[]) {
        const key = `${row.set_name}|${row.product_type}`
        const existing = seen.get(key)
        if (!existing || row.price < existing.price) {
          seen.set(key, {
            set_name: row.set_name,
            product_type: row.product_type,
            title: row.title,
            marketplace: row.marketplace,
            price: parseFloat(String(row.price ?? '0')) || 0,
          })
        }
      }
      setSearchResults(Array.from(seen.values()))
    } catch (err: any) {
      console.error('Search failed:', err.message)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Fetch MTGStocks prices for all inventory items
  useEffect(() => {
    if (items.length === 0) return

    const uniqueSets = Array.from(new Set(items.map(i => i.setName)))

    const fetchPrices = async () => {
      const priceMap = new Map<string, number>()

      for (const setName of uniqueSets) {
        try {
          const { data } = await supabase
            .from('v_mtgstocks_sealed_for_compare')
            .select('normalized_product_type,product_name,avg_price,market_price')
            .ilike('set_name', `%${setName.replace(/ Commander$/, '').trim()}%`)
            .limit(50)

          if (data) {
            for (const row of data as MtgstocksRef[]) {
              const price = row.market_price ?? row.avg_price
              if (!price) continue
              // Key by normalized_product_type when available
              const pt = (row.normalized_product_type || '').toLowerCase()
              if (pt) {
                priceMap.set(`${setName}|${pt}`, price)
              }
              // Also key by product_name as fallback (e.g. "Starter Collection")
              const pn = (row.product_name || '').toLowerCase()
              if (pn) {
                priceMap.set(`${setName}|${pn}`, price)
              }
            }
          }
        } catch { /* skip */ }
      }

      setMtgPrices(priceMap)
    }

    fetchPrices()
  }, [items.length])

  // Get MTGStocks price for an inventory item
  const getMtgPrice = useCallback((item: InventoryItem): number | null => {
    const pt = item.productType.toLowerCase()
    const key = `${item.setName}|${pt}`
    return mtgPrices.get(key) ?? null
  }, [mtgPrices])

  // Calculate totals
  const totals = useMemo(() => {
    let totalCost = 0
    let totalValue = 0
    let totalPL = 0

    for (const item of items) {
      const avgPrice = getMtgPrice(item)
      const costForAll = item.costPaid * item.count
      totalCost += costForAll

      if (avgPrice !== null) {
        const costToSell = (avgPrice * item.feePercent / 100) + item.shippingCost
        const actualValue = avgPrice - costToSell
        totalValue += actualValue * item.count
        totalPL += (actualValue - item.costPaid) * item.count
      }
    }

    return { totalCost, totalValue, totalPL }
  }, [items, getMtgPrice])

  const addFromSearch = (result: SearchResult) => {
    addItem({
      setName: result.set_name,
      productType: result.product_type,
      title: result.title,
      costPaid: 0,
      count: 0,
      feePercent: 15,
      shippingCost: 5,
    })
    setSearchQuery('')
    setSearchResults([])
    setShowSearch(false)
  }

  return (
    <div className="w-full animate-fade-in space-y-6">
      {/* Header */}
      <div className="bg-[var(--bg-surface)] backdrop-blur-xl p-6 rounded-xl border border-[var(--border-color)] shadow-2xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-1)]">Inventory</h2>
            <p className="text-xs text-[var(--text-2)] mt-1">
              {items.length} product{items.length !== 1 ? 's' : ''} tracked
            </p>
          </div>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="px-4 py-2 bg-[var(--brand)] hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Product
          </button>
        </div>

        {/* Search Panel */}
        {showSearch && (
          <div className="mt-4 p-4 bg-[var(--bg-overlay)] rounded-xl border border-[var(--border-color)]">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search sealed products by set name, product type..."
                className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-3 pr-10 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] placeholder:text-[var(--text-2)]/50"
                autoFocus
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
                {searchResults.map((r, idx) => {
                  const alreadyAdded = items.some(
                    i => i.setName === r.set_name && i.productType === r.product_type
                  )
                  return (
                    <button
                      key={idx}
                      onClick={() => !alreadyAdded && addFromSearch(r)}
                      disabled={alreadyAdded}
                      className={`w-full text-left p-3 rounded-lg transition-colors flex justify-between items-center gap-4 ${
                        alreadyAdded
                          ? 'bg-blue-500/10 border border-blue-500/20 opacity-60 cursor-not-allowed'
                          : 'bg-[var(--bg-hover)] hover:bg-[var(--bg-hover-2)] border border-transparent'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[var(--text-1)] truncate">{r.set_name}</div>
                        <div className="text-xs text-[var(--text-2)]">{r.product_type}</div>
                      </div>
                      <div className="text-right shrink-0">
                        {alreadyAdded ? (
                          <span className="text-[10px] text-blue-400 font-bold uppercase">In Inventory</span>
                        ) : (
                          <>
                            <div className="text-sm font-mono text-[var(--accent)]">${r.price.toFixed(2)}</div>
                            <div className="text-[10px] text-[var(--text-2)]">{r.marketplace}</div>
                          </>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
              <p className="mt-3 text-xs text-[var(--text-2)] text-center py-4">No products found</p>
            )}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[var(--bg-surface)] backdrop-blur-xl p-4 rounded-xl border border-[var(--border-color)]">
            <div className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-2)] mb-1">Total Cost</div>
            <div className="text-2xl font-black font-mono text-[var(--text-1)]">${totals.totalCost.toFixed(2)}</div>
          </div>
          <div className="bg-[var(--bg-surface)] backdrop-blur-xl p-4 rounded-xl border border-[var(--border-color)]">
            <div className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-2)] mb-1">Total Value</div>
            <div className="text-2xl font-black font-mono text-[var(--accent)]">${totals.totalValue.toFixed(2)}</div>
          </div>
          <div className="bg-[var(--bg-surface)] backdrop-blur-xl p-4 rounded-xl border border-[var(--border-color)]">
            <div className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-2)] mb-1">Total P/L</div>
            <div className={`text-2xl font-black font-mono ${totals.totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totals.totalPL >= 0 ? '+' : ''}{totals.totalPL.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Inventory Table */}
      <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse table-fixed">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-[var(--bg-2)]/80 text-[var(--text-2)] font-bold uppercase text-[10px] tracking-widest border-b border-[var(--border-color-2)]">
                <tr>
                  <th className="px-4 py-4 text-left">Product</th>
                  <th className="px-3 py-4 text-right">Cost</th>
                  <th className="px-3 py-4 text-center">Qty</th>
                  <th className="px-3 py-4 text-right">Fee %</th>
                  <th className="px-3 py-4 text-right">Ship $</th>
                  <th className="px-3 py-4 text-right">Avg Value</th>
                  <th className="px-3 py-4 text-right">Cost to Sell</th>
                  <th className="px-3 py-4 text-right">Actual Value</th>
                  <th className="px-3 py-4 text-right">P/L (ea)</th>
                  <th className="px-3 py-4 text-right">Total P/L</th>
                  <th className="px-3 py-4 text-center">Del</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((item) => {
                  const avgPrice = getMtgPrice(item)
                  const costToSell = avgPrice !== null ? (avgPrice * item.feePercent / 100) + item.shippingCost : null
                  const actualValue = avgPrice !== null && costToSell !== null ? avgPrice - costToSell : null
                  const pl = actualValue !== null ? actualValue - item.costPaid : null

                  return (
                    <tr key={item.id} className="group hover:bg-[var(--bg-hover)] transition-colors">
                      {/* Product */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-[var(--text-1)] text-xs">{item.setName}</div>
                        <div className="text-[10px] text-[var(--text-2)]">{item.productType}</div>
                      </td>

                      {/* Cost Paid */}
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={item.costPaid}
                          onChange={(e) => updateItem(item.id, { costPaid: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-[var(--bg-2)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
                        />
                      </td>

                      {/* Count */}
                      <td className="px-3 py-3 text-center">
                        <input
                          type="number"
                          min="1"
                          value={item.count}
                          onChange={(e) => updateItem(item.id, { count: parseInt(e.target.value) || 1 })}
                          className="w-14 bg-[var(--bg-2)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-center font-mono text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
                        />
                      </td>

                      {/* Fee % */}
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          step="0.5"
                          value={item.feePercent}
                          onChange={(e) => updateItem(item.id, { feePercent: parseFloat(e.target.value) || 0 })}
                          className="w-16 bg-[var(--bg-2)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-2)] outline-none focus:border-[var(--brand)]"
                        />
                      </td>

                      {/* Shipping */}
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={item.shippingCost}
                          onChange={(e) => updateItem(item.id, { shippingCost: parseFloat(e.target.value) || 0 })}
                          className="w-16 bg-[var(--bg-2)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-right font-mono text-[var(--text-2)] outline-none focus:border-[var(--brand)]"
                        />
                      </td>

                      {/* Avg Value */}
                      <td className="px-3 py-3 text-right font-mono text-xs text-amber-400">
                        {avgPrice !== null ? `$${avgPrice.toFixed(2)}` : '\u2014'}
                      </td>

                      {/* Cost to Sell */}
                      <td className="px-3 py-3 text-right font-mono text-xs text-[var(--text-2)]">
                        {costToSell !== null ? `$${costToSell.toFixed(2)}` : '\u2014'}
                      </td>

                      {/* Actual Value */}
                      <td className="px-3 py-3 text-right font-mono text-xs font-bold text-[var(--accent)]">
                        {actualValue !== null ? `$${actualValue.toFixed(2)}` : '\u2014'}
                      </td>

                      {/* P/L (per unit) */}
                      <td className={`px-3 py-3 text-right font-mono text-xs font-bold ${pl !== null && pl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pl !== null ? `${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}` : '\u2014'}
                      </td>

                      {/* Total P/L */}
                      {(() => {
                        const totalPL = pl !== null ? pl * item.count : null
                        return (
                          <td className={`px-3 py-3 text-right font-mono text-xs font-bold ${totalPL !== null && totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {totalPL !== null ? `${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}` : '\u2014'}
                          </td>
                        )
                      })()}

                      {/* Delete */}
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-[var(--text-2)] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove from inventory"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-20 text-center">
            <svg className="w-16 h-16 mx-auto text-[var(--text-2)] opacity-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-2">No products in inventory</h3>
            <p className="text-sm text-[var(--text-2)] mb-6">
              Click "Add Product" above or use the star icon on PriceCompare / Commander pages
            </p>
            <button
              onClick={() => setShowSearch(true)}
              className="px-6 py-2 bg-[var(--brand)] hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Search Products
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
