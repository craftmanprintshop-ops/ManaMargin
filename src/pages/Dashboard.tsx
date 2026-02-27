/**
 * Dashboard Page
 *
 * Home page showing overview statistics and featured content.
 * Displays real-time data from Supabase including:
 * - Total products, offers, commander decks, and cards
 * - Featured sets with product counts
 * - Low stock alerts
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { dashboardService } from '../services/dashboardService'
import { supabase } from '../services/supabase'
import { useTheme } from '../contexts/ThemeContext'
import { Card } from '../components/common/Card'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { Badge } from '../components/common/Badge'
import { ROUTES } from '../utils/constants'
import { CheckEbayButton } from '../components/common/CheckEbayButton'

interface ScrapeResult {
  ok: boolean
  query?: string
  rows_found?: number
  rows_upserted?: number
  history_events?: number
  error?: string
  message?: string
}

interface ScrapeErrorShape {
  status?: number
  error?: string
  message?: string
}

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

interface EVDeal {
  set_name: string
  product_type: string
  expected_value: number
  botbox_market_price: number | null
  best_total: number
  best_marketplace: string | null
  best_url: string | null
  best_image_url: string | null
  ev_difference: number
}

const PERIOD_OPTIONS = [
  { label: '7 days', value: '7days' },
  { label: '14 days', value: '14days' },
  { label: '30 days', value: '30days' },
  { label: '90 days', value: '90days' },
]

const getFunctionsBaseUrl = (): string | null => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) return null
  try {
    const url = new URL(supabaseUrl)
    return `https://${url.hostname.replace('.supabase.co', '.functions.supabase.co')}`
  } catch {
    return null
  }
}

const parseFunctionBody = async (response: Response): Promise<ScrapeErrorShape | null> => {
  try {
    const json = await response.clone().json()
    if (json && typeof json === 'object') {
      return {
        status: response.status,
        error: (json as any).error,
        message: (json as any).message,
      }
    }
  } catch {
    // no-op: body may be non-json
  }
  return { status: response.status, error: response.statusText || 'Function request failed' }
}

const invokeWatchcountScrape = async (
  query: string,
  days: string,
  expandHistory: boolean,
): Promise<{ data: ScrapeResult | null; error: ScrapeErrorShape | null }> => {
  const { data, error: invokeError } = await supabase.functions.invoke('watchcount-scrape', {
    body: { q: query, days, expand_history: expandHistory ? 'true' : 'false' },
  })

  if (!invokeError) return { data: (data as ScrapeResult) || null, error: null }

  const invokeContext = (invokeError as any)?.context as Response | undefined
  if (invokeContext?.ok === false) {
    const parsed = await parseFunctionBody(invokeContext)
    return { data: null, error: parsed || { error: invokeError.message || 'Edge Function error' } }
  }

  const functionsBaseUrl = getFunctionsBaseUrl()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!functionsBaseUrl || !anonKey) {
    return { data: null, error: { error: invokeError.message || 'Edge Function error' } }
  }

  const url = new URL(`${functionsBaseUrl}/watchcount-scrape`)
  url.searchParams.set('q', query)
  url.searchParams.set('days', days)
  url.searchParams.set('expand_history', expandHistory ? 'true' : 'false')

  const directResp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  })

  if (!directResp.ok) {
    return { data: null, error: await parseFunctionBody(directResp) }
  }

  const directData = (await directResp.json()) as ScrapeResult
  return { data: directData, error: null }
}

const formatScrapeError = (err: ScrapeErrorShape | null): string => {
  if (!err) return 'Edge Function error'
  const combined = `${err.error || ''} ${err.message || ''}`.toLowerCase()
  if (combined.includes('scraper_base_url') && combined.includes('not configured')) {
    return 'Scraper host is not configured in Supabase. Add Edge Function secret SCRAPER_BASE_URL and redeploy watchcount-scrape.'
  }
  if (combined.includes('requested path is invalid') || combined.includes('function not found')) {
    return 'watchcount-scrape is not deployed in this Supabase project (or .env points to a different project). Deploy watchcount-scrape, then retry.'
  }
  if (err.error === 'captcha_detected') {
    return 'WatchCount captcha detected on the scraper host. Save fresh watchcount cookies and retry.'
  }
  if (err.status === 409) {
    return 'WatchCount scrape already in progress. Wait about a minute and retry.'
  }
  if (err.message) return err.message
  if (err.error) return err.error
  if (err.status) return `Edge Function Error (HTTP ${err.status})`
  return 'Edge Function error'
}

const WatchCountScraper: React.FC = () => {
  const [query, setQuery] = useState('')
  const [days, setDays] = useState('30days')
  const [expandHistory, setExpandHistory] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScrapeResult | null>(null)

  const handleScrape = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const { data, error } = await invokeWatchcountScrape(query.trim(), days, expandHistory)
      if (error) {
        setResult({ ok: false, error: formatScrapeError(error), message: error.message })
      } else {
        setResult((data as ScrapeResult) || { ok: false, error: 'No response payload from scrape function' })
      }
    } catch (err: any) {
      setResult({ ok: false, error: err.message || 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }, [query, days, expandHistory])

  return (
    <Card title="WatchCount eBay Scraper">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
          {/* Search query */}
          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-wider mb-1">
              Search Query
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. mtg foundations play booster box"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-inset)] border border-[var(--border-color)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand)] transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleScrape()}
            />
          </div>

          {/* Time period */}
          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-wider mb-1">
              Period
            </label>
            <select
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--bg-inset)] border border-[var(--border-color)] text-[var(--text-1)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors"
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Expand history checkbox */}
          <div className="flex items-center gap-2 pb-0.5">
            <input
              type="checkbox"
              id="expand-history"
              checked={expandHistory}
              onChange={(e) => setExpandHistory(e.target.checked)}
              className="rounded border-[var(--border-color)] accent-[var(--brand)]"
            />
            <label htmlFor="expand-history" className="text-xs text-[var(--text-2)] whitespace-nowrap">
              eBay History
            </label>
          </div>

          {/* Scrape button */}
          <button
            onClick={handleScrape}
            disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity whitespace-nowrap"
          >
            {loading ? 'Scraping...' : 'Scrape'}
          </button>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-2)]">
            <div className="w-4 h-4 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
            Scraping WatchCount... this may take a minute.
          </div>
        )}

        {/* Results */}
        {result && (
          <div className={`p-3 rounded-lg border text-sm ${
            result.ok
              ? 'bg-[var(--color-buy-bg)] border-[var(--color-buy-border)] text-[var(--color-buy)]'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {result.ok ? (
              <div className="space-y-1">
                <div className="font-bold">Scrape complete</div>
                <div className="text-xs opacity-80">
                  Query: "{result.query}" &middot; Found: {result.rows_found} &middot; Upserted: {result.rows_upserted}
                  {result.history_events !== undefined && ` · History events: ${result.history_events}`}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="font-bold">Scrape failed</div>
                <div className="text-xs opacity-80">{result.error}</div>
                {result.message && <div className="text-xs opacity-60">{result.message}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Dashboard page with statistics and overview
 */
export const Dashboard: React.FC = () => {
  const { theme } = useTheme()
  const placeholder = theme === 'dark' ? '/Card_Product_Placeholder_Dark.png' : '/Card_Product_Placeholder.png'
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
  const [evDeals, setEvDeals] = useState<EVDeal[]>([])
  const [evDealsLoading, setEvDealsLoading] = useState(true)

  // Fetch top EV deals
  useEffect(() => {
    const loadEvDeals = async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('v_ev_with_best_offers')
          .select('set_name, product_type, expected_value, botbox_market_price, best_total, best_marketplace, best_url, best_image_url')
          .not('expected_value', 'is', null)
          .not('best_total', 'is', null)
          .order('ev_to_price_ratio', { ascending: false, nullsFirst: false })
          .limit(200)

        if (queryError || !data) return

        const filtered = (data as any[])
          .filter(r => r.expected_value > r.best_total)
          .map(r => ({
            set_name: r.set_name,
            product_type: r.product_type,
            expected_value: r.expected_value,
            botbox_market_price: r.botbox_market_price,
            best_total: r.best_total,
            best_marketplace: r.best_marketplace,
            best_url: r.best_url,
            best_image_url: r.best_image_url,
            ev_difference: r.expected_value - r.best_total,
          }))
          .sort((a, b) => b.ev_difference - a.ev_difference)
          .slice(0, 10)

        setEvDeals(filtered)
      } catch {
        // silent
      } finally {
        setEvDealsLoading(false)
      }
    }
    loadEvDeals()
  }, [])

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
        const decksData = (decksRes.data ?? []) as any[]
        for (const deck of decksData) {
          if (deck.set_name && deck.set_name.toLowerCase().includes('secret lair')) continue
          const nameLower = deck.deck_name.toLowerCase()
          const offersData = (offersRes.data ?? []) as any[]
          const match = offersData.find((o: any) =>
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
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
        <LoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
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
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">Dashboard</h1>
        <p className="mt-2 text-[var(--text-2)]">
          Welcome to ManaMargin - Your MTG price comparison and pack simulator platform
        </p>
      </div>

      {/* Top EV Deals */}
      {evDeals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-[var(--text-1)] uppercase tracking-tight">Top EV Deals</span>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-[var(--color-ev)]/20 text-[var(--color-ev)] border border-[var(--color-ev)]/30">
                EV &gt; Best Price
              </span>
            </div>
            <Link
              to={ROUTES.EV_CALCULATIONS}
              className="text-[10px] font-bold text-[var(--brand)] hover:text-white uppercase tracking-widest transition-colors"
            >
              View All EV →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {evDeals.map((deal) => (
              <div
                key={`${deal.set_name}-${deal.product_type}`}
                className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] overflow-hidden hover:border-[var(--color-ev)]/30 transition-all group"
              >
                {/* Product Image */}
                <div className="aspect-square relative overflow-hidden bg-[var(--bg-image)]">
                  <img
                    src={deal.best_image_url || placeholder}
                    alt={`${deal.set_name} ${deal.product_type}`}
                    className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => (e.currentTarget.src = placeholder)}
                  />
                  {/* Best Price - top right */}
                  <div className="absolute top-2 right-2">
                    {deal.best_url ? (
                      <a
                        href={deal.best_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-buy)] hover:opacity-90 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span className="text-[10px] font-black text-white">${deal.best_total.toFixed(2)}</span>
                      </a>
                    ) : (
                      <div className="px-1.5 py-0.5 rounded bg-[var(--color-buy)] text-[10px] font-black text-white">
                        ${deal.best_total.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Info */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-1)] leading-tight line-clamp-1">{deal.set_name}</div>
                      <div className="text-[10px] text-[var(--text-2)] leading-tight line-clamp-1">{deal.product_type}</div>
                    </div>
                    <CheckEbayButton
                      query={`mtg ${deal.set_name} ${deal.product_type}`}
                      productLabel={`${deal.set_name} ${deal.product_type}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[9px] text-[var(--text-2)] uppercase">Market</div>
                      <div className="text-xs font-mono text-[var(--color-ref)] font-bold">
                        {deal.botbox_market_price !== null ? `$${deal.botbox_market_price.toFixed(2)}` : '\u2014'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-[var(--text-2)] uppercase">EV</div>
                      <div className="text-xs font-mono text-[var(--color-ev)] font-bold">${deal.expected_value.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {evDealsLoading && (
        <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color-2)] p-8">
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-[var(--text-2)] uppercase tracking-widest font-bold">Loading EV deals...</span>
          </div>
        </div>
      )}

      {/* Commander Deck Deals */}
      {deals.length > 0 && (
        <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--color-buy-border)] shadow-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-color-2)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-[var(--text-1)] uppercase tracking-tight">Commander Deck Deals</span>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-[var(--color-buy-bg)] text-[var(--color-buy)] border border-[var(--color-buy-border)]">
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
                className="flex items-center justify-between p-4 bg-[var(--bg-hover)] border border-[var(--border-color-2)] rounded-xl hover:border-[var(--color-buy-border)] hover:bg-[var(--bg-hover)] transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <img
                      src={`https://svgs.scryfall.io/sets/${deal.code.toLowerCase()}.svg`}
                      alt={`${deal.set_name || deal.code} set icon`}
                      className="w-4 h-4 invert opacity-50 shrink-0"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    <span className="text-sm font-bold text-[var(--text-1)] truncate group-hover:text-[var(--color-buy)] transition-colors">
                      {deal.deck_name}
                    </span>
                    <CheckEbayButton
                      query={`mtg ${deal.set_name || ''} ${deal.deck_name}`}
                      productLabel={`${deal.set_name || deal.code.toUpperCase()} ${deal.deck_name}`}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--text-2)] mb-2">
                    {deal.set_name || deal.code.toUpperCase()}
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="text-[var(--text-2)]">
                      Cards: <span className="font-mono text-[var(--color-value)]">${deal.value_over_25c.toFixed(2)}</span>
                    </span>
                    <span className="text-[var(--color-buy)] font-black">
                      Save ${deal.savings.toFixed(2)} ({deal.savings_pct.toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <a
                  href={deal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ml-3 flex flex-col items-center gap-1 px-3 py-2 rounded-lg bg-[var(--color-buy-bg)] border border-[var(--color-buy-border)] hover:bg-[var(--color-buy-bg)] hover:border-[var(--color-buy-hover-border)] transition-all"
                  title={`Buy from ${deal.marketplace}`}
                >
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-[var(--color-buy)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="font-black font-mono text-[var(--color-buy)] text-sm">
                      ${deal.market_price.toFixed(2)}
                    </span>
                  </div>
                  <span className="text-[8px] text-[var(--text-2)] uppercase font-bold">
                    {deal.marketplace}
                  </span>
                </a>
              </div>
            ))}
          </div>
          {deals.length > 6 && (
            <div className="px-6 py-3 border-t border-[var(--border-color-2)] text-center">
              <Link
                to={ROUTES.COMMANDER_DECKS}
                className="text-xs font-bold text-[var(--color-buy)] hover:text-[var(--color-buy)] transition-colors"
              >
                +{deals.length - 6} more deals — View all on Commander Decks page →
              </Link>
            </div>
          )}
        </div>
      )}
      {dealsLoading && (
        <div className="bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color-2)] p-8">
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
                className="flex justify-between items-center p-3 bg-[var(--bg-hover)] rounded-lg hover:bg-[var(--bg-hover-2)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--brand)] text-white font-bold text-sm">
                    {index + 1}
                  </div>
                  <span className="font-medium text-[var(--text-1)]">{set.set_name}</span>
                </div>
                <Badge variant="info">
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
            {summary.lowStockProducts.slice(0, 5).map((product: any) => (
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

      {/* WatchCount Scraper */}
      <WatchCountScraper />

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
