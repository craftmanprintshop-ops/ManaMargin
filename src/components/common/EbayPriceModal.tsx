import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../services/supabase'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface EbayPriceModalProps {
  query: string
  productLabel: string
  onClose: () => void
}

interface SoldEvent {
  sold_date_utc: string
  price_usd: number
  title: string | null
  type: string | null
}

interface DayBucket {
  date: string
  dateRaw: string
  avgPrice: number
  volume: number
}

type ModalState = 'loading' | 'scraping' | 'ready' | 'empty' | 'error'

interface ScrapeErrorShape {
  status?: number
  error?: string
  message?: string
}

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

const invokeWatchcountScrape = async (query: string, days: string): Promise<ScrapeErrorShape | null> => {
  const { error: invokeError } = await supabase.functions.invoke('watchcount-scrape', {
    body: { q: query, days },
  })

  if (!invokeError) return null

  const invokeContext = (invokeError as any)?.context as Response | undefined
  if (invokeContext?.ok === false) {
    const parsed = await parseFunctionBody(invokeContext)
    if (parsed) return parsed
  }

  const functionsBaseUrl = getFunctionsBaseUrl()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!functionsBaseUrl || !anonKey) {
    return { error: invokeError.message || 'Scrape failed' }
  }

  const url = new URL(`${functionsBaseUrl}/watchcount-scrape`)
  url.searchParams.set('q', query)
  url.searchParams.set('days', days)

  const directResp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  })

  if (directResp.ok) return null
  return await parseFunctionBody(directResp)
}

const formatScrapeError = (err: ScrapeErrorShape | null): string => {
  if (!err) return 'Scrape failed'
  const combined = `${err.error || ''} ${err.message || ''}`.toLowerCase()
  if (combined.includes('scraper_base_url') && combined.includes('not configured')) {
    return 'Scraper host is not configured in Supabase. Add Edge Function secret SCRAPER_BASE_URL and redeploy watchcount-scrape.'
  }
  if (combined.includes('requested path is invalid') || combined.includes('function not found')) {
    return 'watchcount-scrape is not deployed in this Supabase project (or .env points to a different project). Deploy watchcount-scrape, then retry.'
  }
  if (err.error === 'captcha_detected') {
    return 'WatchCount captcha detected on the scraper. Save fresh watchcount cookies on the scraper host and retry.'
  }
  if (err.status === 409) {
    return 'A WatchCount scrape is already in progress. Wait about a minute and try again.'
  }
  if (err.message) return err.message
  if (err.error) return err.error
  if (err.status) return `Scrape failed (HTTP ${err.status})`
  return 'Scrape failed'
}

export const EbayPriceModal: React.FC<EbayPriceModalProps> = ({ query, productLabel, onClose }) => {
  const [state, setState] = useState<ModalState>('loading')
  const [events, setEvents] = useState<SoldEvent[]>([])
  const [error, setError] = useState('')

  const fetchEvents = async (): Promise<SoldEvent[]> => {
    const { data, error: fetchErr } = await supabase
      .from('watchcount_sold_events')
      .select('sold_date_utc, price_usd, title, type')
      .eq('query', query)
      .not('price_usd', 'is', null)
      .not('sold_date_utc', 'is', null)
      .order('sold_date_utc', { ascending: true })

    if (fetchErr) throw new Error(fetchErr.message)
    return (data || []) as SoldEvent[]
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        setState('loading')
        const rows = await fetchEvents()

        if (cancelled) return
        if (rows.length > 0) {
          setEvents(rows)
          setState('ready')
          return
        }

        // No cached data — trigger scrape
        setState('scraping')
        if (cancelled) return
        const scrapeErr = await invokeWatchcountScrape(query, '30days')
        if (scrapeErr) {
          setError(formatScrapeError(scrapeErr))
          setState('error')
          return
        }

        // Re-fetch after scrape
        const rows2 = await fetchEvents()
        if (cancelled) return
        if (rows2.length > 0) {
          setEvents(rows2)
          setState('ready')
        } else {
          setState('empty')
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Unknown error')
          setState('error')
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [query])

  const dayBuckets = useMemo<DayBucket[]>(() => {
    if (events.length === 0) return []

    const grouped = new Map<string, number[]>()
    for (const ev of events) {
      const d = new Date(ev.sold_date_utc)
      const key = d.toISOString().slice(0, 10)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(ev.price_usd)
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, prices]) => {
        const d = new Date(dateStr + 'T00:00:00')
        return {
          dateRaw: dateStr,
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          avgPrice: Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100,
          volume: prices.length,
        }
      })
  }, [events])

  const stats = useMemo(() => {
    if (events.length === 0) return null
    const prices = events.map(e => e.price_usd).sort((a, b) => a - b)
    const mid = Math.floor(prices.length / 2)
    const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid]
    return {
      totalSales: events.length,
      median: Math.round(median * 100) / 100,
      min: prices[0],
      max: prices[prices.length - 1],
    }
  }, [events])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl w-full max-w-2xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--text-1)] truncate">{productLabel}</h3>
            <p className="text-[10px] text-[var(--text-2)] uppercase tracking-wider">eBay Sold Prices — Last 30 Days</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors min-h-11 min-w-11 p-2.5 rounded-lg flex items-center justify-center shrink-0" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {state === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-2)]">
              <div className="w-4 h-4 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
              Checking for eBay data...
            </div>
          )}

          {state === 'scraping' && (
            <div className="flex flex-col items-center gap-2 py-16 text-sm text-[var(--text-2)]">
              <div className="w-5 h-5 border-2 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
              <span>No cached data — scraping WatchCount...</span>
              <span className="text-[10px] text-[var(--text-muted)]">This may take up to a minute.</span>
            </div>
          )}

          {state === 'error' && (
            <div className="py-12 text-center">
              <div className="text-sm font-bold text-[var(--color-negative)] mb-1">Failed to load eBay data</div>
              <div className="text-xs text-[var(--text-2)]">{error}</div>
            </div>
          )}

          {state === 'empty' && (
            <div className="py-12 text-center">
              <div className="text-sm font-bold text-[var(--text-2)] mb-1">No eBay sales found</div>
              <div className="text-xs text-[var(--text-muted)]">No sold listings found for "{query}" in the last 30 days.</div>
            </div>
          )}

          {state === 'ready' && stats && (
            <div className="space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-[10px] text-[var(--text-2)] uppercase tracking-wider">Median</div>
                  <div className="text-sm font-bold font-mono text-[var(--brand)]">${stats.median.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-2)] uppercase tracking-wider">Sales</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-ev)]">{stats.totalSales}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-2)] uppercase tracking-wider">Low</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-positive)]">${stats.min.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-2)] uppercase tracking-wider">High</div>
                  <div className="text-sm font-bold font-mono text-[var(--color-negative)]">${stats.max.toFixed(2)}</div>
                </div>
              </div>

              {/* Chart */}
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dayBuckets} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--text-2)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border-color)' }}
                    />
                    <YAxis
                      yAxisId="price"
                      tick={{ fontSize: 10, fill: 'var(--text-2)' }}
                      tickFormatter={(v: number) => `$${v}`}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <YAxis
                      yAxisId="volume"
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--text-2)' }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value?: number, name?: string) => {
                        const v = value ?? 0
                        return name === 'avgPrice' ? [`$${v.toFixed(2)}`, 'Avg Price'] : [v, 'Sales']
                      }}
                      labelStyle={{ color: 'var(--text-1)', fontWeight: 'bold' }}
                    />
                    <Bar yAxisId="price" dataKey="avgPrice" fill="var(--brand)" opacity={0.6} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="volume" dataKey="volume" stroke="var(--color-ev)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)] text-center">
          Data from WatchCount / eBay
        </div>
      </div>
    </div>
  )
}
