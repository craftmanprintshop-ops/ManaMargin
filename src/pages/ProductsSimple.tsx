/**
 * Products Page
 *
 * Shows products grouped by set, with individual product type rows.
 * Click a product row to expand and see individual marketplace offers.
 * Uses offers_latest_enriched_mv (materialized view) which has enriched data.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { supabase } from '../services/supabase'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { ErrorMessage } from '../components/common/ErrorMessage'

interface ProductRow {
  product_type: string
  offer_count: number
  avg_price: number | null
  min_price: number | null
  max_price: number | null
  latest_fetch: string | null
}

interface SetGroup {
  set_name: string
  set_type: string | null
  total_offers: number
  total_avg: number | null
  total_min: number | null
  total_max: number | null
  products: ProductRow[]
}

interface OfferDetail {
  id: string
  marketplace: string
  title: string
  price: number
  shipping: number | null
  in_stock: boolean
  url: string
  fetched_at: string
  foil: string | null
  image_url: string | null
}

async function fetchGroupedProducts(): Promise<SetGroup[]> {
  const { data, error } = await supabase
    .from('offers_latest_enriched_mv')
    .select('set_name, set_type, product_type, price, fetched_at')
    .not('set_name', 'is', null)
    .limit(5000)

  if (error) {
    throw new Error(`Failed to fetch product summaries: ${error.message}`)
  }

  const setMap = new Map<string, {
    set_type: string | null
    products: Map<string, { prices: number[]; latest_fetch: string | null }>
  }>()

  data?.forEach((row: any) => {
    const setName = row.set_name
    if (!setName) return

    if (!setMap.has(setName)) {
      setMap.set(setName, { set_type: row.set_type, products: new Map() })
    }
    const setData = setMap.get(setName)!
    const pt = row.product_type || 'Unknown'

    if (!setData.products.has(pt)) {
      setData.products.set(pt, { prices: [], latest_fetch: null })
    }
    const prodData = setData.products.get(pt)!

    if (row.price !== null && row.price !== undefined) {
      prodData.prices.push(parseFloat(row.price))
    }
    if (row.fetched_at && (!prodData.latest_fetch || row.fetched_at > prodData.latest_fetch)) {
      prodData.latest_fetch = row.fetched_at
    }
  })

  const groups: SetGroup[] = Array.from(setMap.entries()).map(([set_name, setData]) => {
    const products: ProductRow[] = Array.from(setData.products.entries()).map(([product_type, pd]) => ({
      product_type,
      offer_count: pd.prices.length,
      avg_price: pd.prices.length > 0 ? pd.prices.reduce((a, b) => a + b, 0) / pd.prices.length : null,
      min_price: pd.prices.length > 0 ? Math.min(...pd.prices) : null,
      max_price: pd.prices.length > 0 ? Math.max(...pd.prices) : null,
      latest_fetch: pd.latest_fetch,
    }))

    products.sort((a, b) => (b.offer_count - a.offer_count) || a.product_type.localeCompare(b.product_type))

    const allPrices = products.flatMap(p =>
      p.avg_price !== null ? [p.min_price!, p.max_price!] : []
    )

    return {
      set_name,
      set_type: setData.set_type,
      total_offers: products.reduce((s, p) => s + p.offer_count, 0),
      total_avg: allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : null,
      total_min: allPrices.length > 0 ? Math.min(...allPrices) : null,
      total_max: allPrices.length > 0 ? Math.max(...allPrices) : null,
      products,
    }
  })

  groups.sort((a, b) => b.total_offers - a.total_offers)
  return groups
}

// --- Expandable offers sub-row ---
const OffersPanel: React.FC<{ setName: string; productType: string }> = ({ setName, productType }) => {
  const [offers, setOffers] = useState<OfferDetail[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadOffers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('offers_latest_enriched_mv')
        .select('id,marketplace,title,price,shipping,in_stock,url,fetched_at,foil,image_url')
        .eq('set_name', setName)
        .eq('product_type', productType)
        .order('price', { ascending: true })
        .limit(50)

      if (error) throw error

      setOffers((data ?? []).map((o: any) => ({
        ...o,
        price: parseFloat(String(o.price ?? '0')) || 0,
        shipping: o.shipping === null ? null : (parseFloat(String(o.shipping ?? '0')) || 0),
      })))
    } catch (err) {
      console.error('Failed to load offers:', err)
    } finally {
      setIsLoading(false)
    }
  }, [setName, productType])

  useEffect(() => { loadOffers() }, [loadOffers])

  if (isLoading) {
    return (
      <tr>
        <td colSpan={99} className="px-6 py-6 bg-[var(--bg-hover)]">
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-[var(--text-2)] uppercase tracking-widest font-bold">Loading offers...</span>
          </div>
        </td>
      </tr>
    )
  }

  if (offers.length === 0) {
    return (
      <tr>
        <td colSpan={99} className="px-6 py-6 bg-[var(--bg-hover)] text-center text-[var(--text-2)] text-xs">
          No offers found.
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td colSpan={99} className="p-0">
        <div className="bg-[var(--bg-hover)] border-y border-[var(--border-color-2)]">
          <div className="px-6 py-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {offers.map((offer) => (
              <a
                key={offer.id}
                href={offer.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between p-3 bg-[var(--bg-hover)] border border-[var(--border-color-2)] rounded-lg hover:border-[var(--brand)]/40 hover:bg-[var(--bg-hover)] transition-all group/offer ${!offer.in_stock ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {offer.image_url ? (
                    <img
                      src={offer.image_url}
                      alt=""
                      className="w-10 h-10 object-contain rounded shrink-0"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  ) : (
                    <svg className="w-5 h-5 text-green-400 opacity-60 group-hover/offer:opacity-100 transition-opacity shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  )}
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase font-black tracking-widest text-[var(--brand)] mb-0.5">
                      {offer.marketplace}
                    </div>
                    <div className="text-white text-xs font-medium truncate" title={offer.title}>
                      {offer.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {!offer.in_stock && (
                        <span className="text-[8px] font-bold text-red-400 bg-red-500/10 px-1 rounded uppercase">Out of Stock</span>
                      )}
                      {offer.foil && offer.foil !== 'Non-Foil' && (
                        <span className="text-[8px] font-bold text-purple-400 bg-purple-500/10 px-1 rounded uppercase">{offer.foil}</span>
                      )}
                      <span className="text-[9px] text-[var(--text-2)] font-mono">
                        {new Date(offer.fetched_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <div className="text-[var(--accent)] font-black font-mono text-sm">
                    ${offer.price.toFixed(2)}
                  </div>
                  {offer.shipping !== null && offer.shipping > 0 && (
                    <div className="text-[9px] text-[var(--text-2)]">
                      +${offer.shipping.toFixed(2)} ship
                    </div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      </td>
    </tr>
  )
}

// --- Main Component ---
export const ProductsSimple: React.FC = () => {
  const { data: groups, loading, error } = useSupabaseQuery(
    () => fetchGroupedProducts(),
    []
  )

  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const toggleExpand = (key: string) => {
    setExpandedKey(prev => prev === key ? null : key)
  }

  const filteredGroups = useMemo(() => {
    if (!groups || !searchTerm) return groups
    const term = searchTerm.toLowerCase()
    return groups
      .map(group => {
        const setMatches = group.set_name.toLowerCase().includes(term) ||
          (group.set_type || '').toLowerCase().includes(term)
        if (setMatches) return group
        const matchingProducts = group.products.filter(p =>
          p.product_type.toLowerCase().includes(term)
        )
        if (matchingProducts.length === 0) return null
        return { ...group, products: matchingProducts }
      })
      .filter((g): g is SetGroup => g !== null)
  }, [groups, searchTerm])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Product & Set Summary</h1>
        <LoadingSpinner size="lg" text="Loading product data..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Product & Set Summary</h1>
        <ErrorMessage
          title="Failed to load products"
          message={error.message}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  return (
    <div className="w-full animate-fade-in">
      <h2 className="text-3xl font-bold text-center text-[var(--text-1)] mb-6">
        Product & Set Summary
      </h2>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search sets or products..."
          className="w-full max-w-md mx-auto block bg-[var(--bg-2)] border border-white/20 rounded-lg p-2.5 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] placeholder:text-[var(--text-2)]/50 transition-colors"
        />
      </div>

      <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[var(--bg-surface-2)] text-[var(--text-2)] font-bold uppercase text-[10px] tracking-widest sticky top-0 z-10 border-b border-[var(--border-color-2)]">
              <tr>
                <th className="px-3 sm:px-6 py-4">Set / Product</th>
                <th className="px-2 sm:px-4 py-4 text-right hidden sm:table-cell">Offers</th>
                <th className="px-2 sm:px-4 py-4 text-right hidden md:table-cell">Avg Price</th>
                <th className="px-2 sm:px-4 py-4 text-right">Min</th>
                <th className="px-2 sm:px-4 py-4 text-right text-[var(--accent)]">Max</th>
                <th className="px-2 sm:px-4 py-4 text-right hidden lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredGroups?.map((group) => (
                <React.Fragment key={group.set_name}>
                  {/* Set Header Row */}
                  <tr className="bg-blue-500/10 border-y border-[var(--border-color-2)]">
                    <td className="px-3 sm:px-6 py-3">
                      <div className="flex flex-wrap items-center gap-1 sm:gap-3">
                        <span className="text-xs sm:text-sm font-bold text-white uppercase tracking-tight">
                          {group.set_name}
                        </span>
                        {group.set_type && (
                          <span className="font-mono text-[var(--text-2)] bg-[var(--bg-hover)] px-2 py-0.5 rounded text-[10px] capitalize hidden sm:inline">
                            {group.set_type}
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--text-2)] opacity-60">
                          {group.products.length} product{group.products.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-right font-bold text-white text-xs hidden sm:table-cell">
                      {group.total_offers}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-right font-mono text-white/70 text-xs hidden md:table-cell">
                      {group.total_avg !== null ? `$${group.total_avg.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-right font-mono text-white/70 text-xs">
                      {group.total_min !== null ? `$${group.total_min.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-3 text-right font-mono font-bold text-[var(--accent)] text-sm">
                      {group.total_max !== null ? `$${group.total_max.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-3 hidden lg:table-cell"></td>
                  </tr>

                  {/* Individual Product Rows */}
                  {group.products.map((product) => {
                    const rowKey = `${group.set_name}|${product.product_type}`
                    const isExpanded = expandedKey === rowKey

                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-500/10' : 'hover:bg-blue-500/5'}`}
                          onClick={() => toggleExpand(rowKey)}
                        >
                          <td className="px-3 sm:px-6 py-3 pl-6 sm:pl-12">
                            <div className="flex items-center gap-2">
                              <svg
                                className={`w-3 h-3 text-[var(--text-2)] transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className={`text-xs sm:text-sm ${isExpanded ? 'text-[var(--brand)] font-bold' : 'text-[var(--text-1)]'}`}>
                                {product.product_type}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right text-[var(--text-2)] text-xs hidden sm:table-cell">
                            {product.offer_count}
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right font-mono text-[var(--text-2)] text-xs hidden md:table-cell">
                            {product.avg_price !== null ? `$${product.avg_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right font-mono text-[var(--text-2)] text-xs">
                            {product.min_price !== null ? `$${product.min_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right font-mono font-bold text-[var(--accent)] text-xs">
                            {product.max_price !== null ? `$${product.max_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-2 sm:px-4 py-3 text-right text-[var(--text-2)] text-[10px] font-mono hidden lg:table-cell">
                            {product.latest_fetch
                              ? new Date(product.latest_fetch).toLocaleDateString()
                              : '—'}
                          </td>
                        </tr>

                        {/* Expanded Offers Panel */}
                        {isExpanded && (
                          <OffersPanel setName={group.set_name} productType={product.product_type} />
                        )}
                      </React.Fragment>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
