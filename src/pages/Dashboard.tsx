/**
 * Dashboard Page
 *
 * Home page showing overview statistics and featured content.
 * Displays real-time data from Supabase including:
 * - Total products, offers, commander decks, and cards
 * - Featured sets with product counts
 * - Low stock alerts
 */

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { dashboardService } from '../services/dashboardService'
import { supabase } from '../services/supabase'
import { Card } from '../components/common/Card'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { Badge } from '../components/common/Badge'
import { ROUTES } from '../utils/constants'

interface DeckDeal {
  code: string
  deck_name: string
  set_name: string | null
  value_over_25c: number
  market_price: number
  marketplace: string
  url: string
  savings: number
  savings_pct: number
}

/**
 * Dashboard page with statistics and overview
 */
export const Dashboard: React.FC = () => {
  // Fetch dashboard data
  const {
    data: summary,
    loading,
    error,
  } = useSupabaseQuery(
    () => dashboardService.getDashboardSummary(),
    [] // Fetch once on mount
  )

  const [deals, setDeals] = useState<DeckDeal[]>([])
  const [dealsLoading, setDealsLoading] = useState(true)

  useEffect(() => {
    const loadDeals = async () => {
      try {
        // Fetch deck values and market offers in parallel
        const [decksRes, offersRes] = await Promise.all([
          supabase
            .from('v_commander_deck_values')
            .select('code,deck_name,set_name,value_over_25c')
            .order('release_date', { ascending: false }),
          supabase
            .from('offers_latest_enriched_mv')
            .select('title,marketplace,price,url,in_stock')
            .eq('product_type', 'Commander Deck')
            .eq('in_stock', true)
            .order('price', { ascending: true })
            .limit(2000),
        ])

        if (decksRes.error || offersRes.error) return

        const deckDeals: DeckDeal[] = []
        for (const deck of decksRes.data ?? []) {
          if (deck.set_name && deck.set_name.toLowerCase().includes('secret lair')) continue
          const nameLower = deck.deck_name.toLowerCase()
          const match = (offersRes.data ?? []).find((o: any) =>
            (o.title || '').toLowerCase().includes(nameLower)
          )
          if (!match) continue

          const marketPrice = parseFloat(String(match.price ?? '0')) || 0
          const cardValue = deck.value_over_25c || 0
          if (marketPrice >= cardValue || cardValue === 0) continue

          const savings = cardValue - marketPrice
          deckDeals.push({
            code: deck.code,
            deck_name: deck.deck_name,
            set_name: deck.set_name,
            value_over_25c: cardValue,
            market_price: marketPrice,
            marketplace: match.marketplace,
            url: match.url,
            savings,
            savings_pct: (savings / cardValue) * 100,
          })
        }

        // Sort by savings percentage descending
        deckDeals.sort((a, b) => b.savings_pct - a.savings_pct)
        setDeals(deckDeals)
      } catch (err) {
        console.error('Failed to load deals:', err)
      } finally {
        setDealsLoading(false)
      }
    }
    loadDeals()
  }, [])

  // Show loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
        <LoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
        <ErrorMessage
          title="Failed to load dashboard"
          message={error.message || 'Could not fetch dashboard data'}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
        <p className="mt-2 text-[var(--text-2)]">
          Welcome to ManaMargin - Your MTG price comparison and pack simulator platform
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card padding="md">
          <div className="text-center">
            <p className="text-sm text-[var(--text-2)] mb-2">Total Products</p>
            <p className="text-4xl font-bold text-primary-600">
              {summary?.totalProducts.toLocaleString() || 0}
            </p>
            <p className="text-xs text-[var(--text-2)]/70 mt-2">Sealed products tracked</p>
          </div>
        </Card>

        <Card padding="md">
          <div className="text-center">
            <p className="text-sm text-[var(--text-2)] mb-2">Latest Offers</p>
            <p className="text-4xl font-bold text-blue-600">
              {summary?.totalOffers.toLocaleString() || 0}
            </p>
            <p className="text-xs text-[var(--text-2)]/70 mt-2">Price points (last 7 days)</p>
          </div>
        </Card>

        <Card padding="md">
          <div className="text-center">
            <p className="text-sm text-[var(--text-2)] mb-2">Commander Decks</p>
            <p className="text-4xl font-bold text-purple-600">
              {summary?.commanderDecks.toLocaleString() || 0}
            </p>
            <p className="text-xs text-[var(--text-2)]/70 mt-2">Precon decks valued</p>
          </div>
        </Card>

        <Card padding="md">
          <div className="text-center">
            <p className="text-sm text-[var(--text-2)] mb-2">Total Cards</p>
            <p className="text-4xl font-bold text-green-600">
              {summary?.totalCards.toLocaleString() || 0}
            </p>
            <p className="text-xs text-[var(--text-2)]/70 mt-2">Unique cards in database</p>
          </div>
        </Card>
      </div>

      {/* Commander Deck Deals */}
      {deals.length > 0 && (
        <div className="bg-[#0f111a]/80 backdrop-blur-xl rounded-xl border border-green-500/20 shadow-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-white uppercase tracking-tight">Commander Deck Deals</span>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
              </span>
            </div>
            <Link
              to={ROUTES.COMMANDER_DECKS}
              className="text-[10px] font-bold text-[var(--brand)] hover:text-white uppercase tracking-widest transition-colors"
            >
              View All Decks →
            </Link>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {deals.slice(0, 6).map((deal) => (
              <div
                key={`${deal.code}|${deal.deck_name}`}
                className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-xl hover:border-green-500/30 hover:bg-green-500/[0.03] transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <img
                      src={`https://svgs.scryfall.io/sets/${deal.code.toLowerCase()}.svg`}
                      alt=""
                      className="w-4 h-4 invert opacity-50 shrink-0"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    <span className="text-sm font-bold text-white truncate group-hover:text-green-300 transition-colors">
                      {deal.deck_name}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--text-2)] mb-2">
                    {deal.set_name || deal.code.toUpperCase()}
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-[var(--text-2)]">
                      Cards: <span className="font-mono text-blue-300">${deal.value_over_25c.toFixed(2)}</span>
                    </span>
                    <span className="text-green-400 font-black">
                      Save ${deal.savings.toFixed(2)} ({deal.savings_pct.toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <a
                  href={deal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ml-3 flex flex-col items-center gap-1 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 hover:border-green-500/40 transition-all"
                  title={`Buy from ${deal.marketplace}`}
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(deal.url).hostname } catch { return '' } })()}&sz=16`}
                    alt=""
                    className="w-4 h-4 opacity-70 shrink-0"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  <span className="font-black font-mono text-green-400 text-sm">
                    ${deal.market_price.toFixed(2)}
                  </span>
                  <span className="text-[8px] text-[var(--text-2)] uppercase font-bold">
                    {deal.marketplace}
                  </span>
                </a>
              </div>
            ))}
          </div>
          {deals.length > 6 && (
            <div className="px-6 py-3 border-t border-white/5 text-center">
              <Link
                to={ROUTES.COMMANDER_DECKS}
                className="text-xs font-bold text-green-400 hover:text-green-300 transition-colors"
              >
                +{deals.length - 6} more deals — View all on Commander Decks page →
              </Link>
            </div>
          )}
        </div>
      )}
      {dealsLoading && (
        <div className="bg-[#0f111a]/80 backdrop-blur-xl rounded-xl border border-white/5 p-8">
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-[var(--text-2)] uppercase tracking-widest font-bold">Scanning for deals...</span>
          </div>
        </div>
      )}

      {/* Featured Sets */}
      {summary?.featuredSets && summary.featuredSets.length > 0 && (
        <Card title="Featured Sets">
          <div className="space-y-3">
            {summary.featuredSets.map((set, index) => (
              <div
                key={set.set_name}
                className="flex justify-between items-center p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-600 font-bold text-sm">
                    {index + 1}
                  </div>
                  <span className="font-medium text-[var(--text-1)]">{set.set_name}</span>
                </div>
                <Badge variant="default">
                  {set.count} {set.count === 1 ? 'product' : 'products'}
                </Badge>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link
              to={ROUTES.PRODUCTS}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              View all products →
            </Link>
          </div>
        </Card>
      )}

      {/* Low Stock Alerts */}
      {summary?.lowStockProducts && summary.lowStockProducts.length > 0 && (
        <Card title="Low Stock Alerts">
          <div className="space-y-2">
            {summary.lowStockProducts.slice(0, 5).map((product) => (
              <div
                key={product.offer_id}
                className="flex justify-between items-center p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--text-1)] truncate">{product.product_name}</p>
                  <p className="text-sm text-[var(--text-2)]">
                    {product.marketplace} • {product.set_name}
                  </p>
                </div>
                <div className="ml-4 text-right">
                  <Badge variant="warning" size="sm">
                    {product.stock_status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link
              to={ROUTES.PRODUCTS}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              View all offers →
            </Link>
          </div>
        </Card>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link to={ROUTES.PRODUCTS}>
          <Card padding="md" className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-[var(--text-1)] mb-2">
                🛒 Price Comparison
              </h3>
              <p className="text-sm text-[var(--text-2)]">
                Compare sealed product prices across multiple retailers
              </p>
            </div>
          </Card>
        </Link>

        <Link to={ROUTES.EV_CALCULATIONS}>
          <Card padding="md" className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-[var(--text-1)] mb-2">
                📊 EV Calculations
              </h3>
              <p className="text-sm text-[var(--text-2)]">
                Expected value and best marketplace prices
              </p>
            </div>
          </Card>
        </Link>

        <Link to={ROUTES.COMMANDER_DECKS}>
          <Card padding="md" className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-[var(--text-1)] mb-2">
                ⚔️ Commander Decks
              </h3>
              <p className="text-sm text-[var(--text-2)]">
                Browse precon decks with full card valuations
              </p>
            </div>
          </Card>
        </Link>
      </div>

      {/* About ManaMargin */}
      <Card title="About ManaMargin">
        <div className="prose prose-sm max-w-none">
          <p className="text-[var(--text-2)] mb-4">
            ManaMargin is your comprehensive Magic: The Gathering price comparison and pack simulator platform.
            We aggregate data from multiple retailers to help you find the best deals on sealed products.
          </p>
          <ul className="list-disc list-inside space-y-2 text-[var(--text-2)]">
            <li>
              <strong>Price Comparison:</strong> Compare sealed product prices across TCGPlayer, Card Kingdom, and more
            </li>
            <li>
              <strong>Pack Simulator:</strong> Simulate booster pack openings and calculate expected value based on real market prices
            </li>
            <li>
              <strong>Commander Decks:</strong> Browse all preconstructed commander decks with full card lists and valuations
            </li>
            <li>
              <strong>Real-time Data:</strong> Prices updated regularly via automated scrapers
            </li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
