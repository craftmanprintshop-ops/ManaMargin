/**
 * Price Compare Page
 *
 * Marketplace price comparison with cascading filters.
 * Uses offers_latest_enriched_mv materialized view.
 * Supports list (table) and card view modes.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../services/supabase'
import { useInventory } from '../hooks/useInventory'

// --- Types ---

interface SetOption {
  name: string
  type: string | null
}

interface PriceOffer {
  id: string
  canonical_sku: string
  marketplace: string
  source_key: string
  title: string
  price: number
  shipping: number | null
  in_stock: boolean
  url: string
  fetched_at: string
  set_name: string | null
  set_type: string | null
  product_type: string | null
  foil: string | null
  image_url: string | null
  total: number
  isTaxed: boolean
}

interface MtgstocksRef {
  product_name: string
  normalized_product_type: string
  avg_price: number | null
  market_price: number | null
  url: string | null
  fetched_at: string | null
}

interface BotboxEv {
  product_name: string
  expected_value: number | null
  ev_to_price_ratio: number | null
}

interface MarketplaceSetting {
  name: string
  shippingCost: number
  taxed: boolean
  freeOver: number
}

type SortKey = 'set_name' | 'product_type' | 'price' | 'shipping' | 'total' | 'in_stock' | 'marketplace' | 'fetched_at'
type SortDirection = 'asc' | 'desc'

// --- Constants ---

const DEFAULT_SETTINGS: MarketplaceSetting[] = [
  { name: 'tradingcardmarket', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'minmaxgames', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'gamenerdz', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'forgeandfire', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'tcgplayer', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'geekerygames', shippingCost: 0, taxed: false, freeOver: 0 },
  { name: 'collectorstore', shippingCost: 0, taxed: false, freeOver: 0 },
]

// --- Component ---

export const PriceCompare: React.FC = () => {
  // Inventory
  const { isInInventory, toggleItem } = useInventory()

  // Dropdown options
  const [availableSets, setAvailableSets] = useState<SetOption[]>([])
  const [availableProductTypes, setAvailableProductTypes] = useState<string[]>(['Any'])
  const [availableFoilTypes, setAvailableFoilTypes] = useState<string[]>(['Any'])

  // Marketplace settings
  const [marketSettings, setMarketSettings] = useState<MarketplaceSetting[]>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)

  // Selections
  const [selectedSetKey, setSelectedSetKey] = useState<string>('Any|All Sets')
  const [selectedProductType, setSelectedProductType] = useState<string>('Any')
  const [selectedFoil, setSelectedFoil] = useState<string>('Any')
  const [stockFilter, setStockFilter] = useState<'In Stock' | 'All'>('In Stock')

  // Results
  const [offers, setOffers] = useState<PriceOffer[]>([])

  // Loading states
  const [isLoadingSets, setIsLoadingSets] = useState(false)
  const [isLoadingProductTypes, setIsLoadingProductTypes] = useState(false)
  const [isLoadingFoils, setIsLoadingFoils] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  // MTGStocks reference prices
  const [mtgstocksRefs, setMtgstocksRefs] = useState<Map<string, MtgstocksRef>>(new Map())

  // BotBox EV data
  const [botboxEvs, setBotboxEvs] = useState<Map<string, BotboxEv>>(new Map())

  // Errors
  const [searchError, setSearchError] = useState<string | null>(null)

  // Sorting
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'total',
    direction: 'asc',
  })

  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card')

  // Derived selection
  const [selectedSetName, selectedSetType] = useMemo(() => {
    const parts = (selectedSetKey || '').split('|')
    return [parts[0] ?? 'Any', parts[1] ?? 'All Sets']
  }, [selectedSetKey])

  // Load saved marketplace settings
  useEffect(() => {
    const saved = localStorage.getItem('marketplace_settings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as MarketplaceSetting[]
        const merged = DEFAULT_SETTINGS.map(def => {
          const existing = parsed.find(p => p.name.toLowerCase() === def.name.toLowerCase())
          return existing ? existing : def
        })
        setMarketSettings(merged)
      } catch {
        setMarketSettings(DEFAULT_SETTINGS)
      }
    }
  }, [])

  // Save marketplace settings
  const saveSettings = () => {
    localStorage.setItem('marketplace_settings', JSON.stringify(marketSettings))
    setShowSettings(false)
  }

  // Load sets
  const loadSets = useCallback(async () => {
    setIsLoadingSets(true)
    try {
      const { data, error } = await supabase
        .from('offers_latest_enriched_mv')
        .select('set_name, set_type')
        .not('product_type', 'is', null)
        .limit(2000)

      if (error) throw error

      const uniqueMap = new Map<string, SetOption>()
      ;(data ?? []).forEach((row: any) => {
        const name = (row.set_name || '').trim()
        if (name && !uniqueMap.has(name)) {
          uniqueMap.set(name, { name, type: row.set_type })
        }
      })

      const result = Array.from(uniqueMap.values())
      result.sort((a, b) => a.name.localeCompare(b.name))
      setAvailableSets(result)
    } catch (err: any) {
      console.error('Error loading sets:', err.message)
    } finally {
      setIsLoadingSets(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadSets()
  }, [loadSets])

  // Cascade: Load product types when set changes
  useEffect(() => {
    let cancelled = false

    const loadTypes = async () => {
      setSelectedProductType('Any')
      setAvailableProductTypes(['Any'])
      setIsLoadingProductTypes(true)

      try {
        let q = supabase.from('offers_latest_enriched_mv').select('product_type')
          .not('product_type', 'is', null)

        if (selectedSetName !== 'Any' && selectedSetName !== '') {
          q = q.eq('set_name', selectedSetName.trim())
        }
        if (selectedSetType && selectedSetType !== 'All Sets' && selectedSetType !== 'null') {
          q = q.eq('set_type', selectedSetType.trim())
        }

        const { data, error } = await q.limit(5000)
        if (error) throw error

        if (!cancelled) {
          const types = Array.from(new Set((data ?? []).map((r: any) => r.product_type).filter(Boolean)))
          types.sort()
          setAvailableProductTypes(['Any', ...types])
        }
      } catch (err: any) {
        console.error('Error loading product types:', err.message)
        if (!cancelled) setAvailableProductTypes(['Any'])
      } finally {
        if (!cancelled) setIsLoadingProductTypes(false)
      }
    }

    loadTypes()
    return () => { cancelled = true }
  }, [selectedSetName, selectedSetType])

  // Cascade: Load foils when set or product type changes
  useEffect(() => {
    let cancelled = false

    const loadFoils = async () => {
      setSelectedFoil('Any')
      setAvailableFoilTypes(['Any'])
      setIsLoadingFoils(true)

      try {
        let q = supabase.from('offers_latest_enriched_mv').select('foil')
          .not('product_type', 'is', null)

        if (selectedSetName !== 'Any' && selectedSetName !== '') {
          q = q.eq('set_name', selectedSetName.trim())
        }
        if (selectedSetType && selectedSetType !== 'All Sets' && selectedSetType !== 'null') {
          q = q.eq('set_type', selectedSetType.trim())
        }
        if (selectedProductType && selectedProductType !== 'Any') {
          q = q.eq('product_type', selectedProductType.trim())
        }

        const { data, error } = await q.limit(5000)
        if (error) throw error

        if (!cancelled) {
          const uniqueFoils = new Set<string>()
          ;(data ?? []).forEach((r: any) => {
            if (r.foil === null || r.foil === undefined || (r.foil as string).trim() === '') {
              uniqueFoils.add('Non-Foil')
            } else {
              uniqueFoils.add((r.foil as string).trim())
            }
          })
          const result = Array.from(uniqueFoils)
          result.sort()
          setAvailableFoilTypes(['Any', ...result])
        }
      } catch (err: any) {
        console.error('Error loading foils:', err.message)
        if (!cancelled) setAvailableFoilTypes(['Any'])
      } finally {
        if (!cancelled) setIsLoadingFoils(false)
      }
    }

    loadFoils()
    return () => { cancelled = true }
  }, [selectedSetName, selectedSetType, selectedProductType])

  // Search
  const handleSearch = useCallback(async () => {
    setIsSearching(true)
    setSearchError(null)

    try {
      let q = supabase
        .from('offers_latest_enriched_mv')
        .select('id,canonical_sku,marketplace,source_key,title,price,shipping,in_stock,url,image_url,fetched_at,created_at,set_name,set_type,product_type,foil')
        .not('product_type', 'is', null)

      if (selectedSetName !== 'Any' && selectedSetName !== '') {
        q = q.eq('set_name', selectedSetName.trim())
      }
      if (selectedSetType && selectedSetType !== 'All Sets' && selectedSetType !== 'null' && selectedSetType !== 'undefined') {
        q = q.eq('set_type', selectedSetType.trim())
      }
      if (selectedProductType && selectedProductType !== 'Any') {
        q = q.eq('product_type', selectedProductType.trim())
      }
      if (selectedFoil && selectedFoil !== 'Any') {
        if (selectedFoil === 'Non-Foil') {
          q = q.or('foil.is.null,foil.eq.Non-Foil')
        } else {
          q = q.eq('foil', selectedFoil.trim())
        }
      }

      q = q.order('price', { ascending: true })

      const { data, error } = await q.limit(500)
      if (error) throw error

      const enriched: PriceOffer[] = (data ?? []).map((offer: any) => {
        const price = parseFloat(String(offer.price ?? '0')) || 0
        const setting = marketSettings.find(s => s.name.toLowerCase() === (offer.marketplace || '').toLowerCase())
        const baseShipping = offer.shipping === null ? null : (parseFloat(String(offer.shipping ?? '0')) || 0)

        let appliedShipping = baseShipping !== null ? baseShipping : (setting?.shippingCost ?? 0)

        if (setting && setting.freeOver > 0 && price >= setting.freeOver) {
          appliedShipping = 0
        }

        const total = price + appliedShipping

        return {
          ...offer,
          price,
          shipping: appliedShipping,
          total,
          isTaxed: setting?.taxed ?? false,
        }
      })

      setOffers(enriched)

      // Also fetch MTGStocks reference prices for the selected set
      if (selectedSetName !== 'Any' && selectedSetName !== '') {
        try {
          const { data: mtgData } = await supabase
            .from('v_mtgstocks_sealed_for_compare')
            .select('product_name,normalized_product_type,avg_price,market_price,url,fetched_at')
            .ilike('set_name', `%${selectedSetName.replace(/ Commander$/, '').trim()}%`)
            .limit(100)

          if (mtgData && mtgData.length > 0) {
            const refMap = new Map<string, MtgstocksRef>()
            for (const item of mtgData as any[]) {
              const key = (item.normalized_product_type || '').toLowerCase()
              if (key && !refMap.has(key)) {
                refMap.set(key, {
                  product_name: item.product_name,
                  normalized_product_type: item.normalized_product_type,
                  avg_price: item.avg_price ? parseFloat(String(item.avg_price)) : null,
                  market_price: item.market_price ? parseFloat(String(item.market_price)) : null,
                  url: item.url,
                  fetched_at: item.fetched_at,
                })
              }
            }
            setMtgstocksRefs(refMap)
          } else {
            setMtgstocksRefs(new Map())
          }
        } catch {
          // Don't fail the main search if MTGStocks fails
          setMtgstocksRefs(new Map())
        }
      } else {
        setMtgstocksRefs(new Map())
      }

      // Fetch BotBox EV data via canonical product mappings
      if (selectedSetName !== 'Any' && selectedSetName !== '') {
        try {
          const { data: evData } = await supabase
            .from('v_ev_with_best_offers')
            .select('product_type,expected_value,ev_to_price_ratio')
            .eq('set_name', selectedSetName.trim())
            .limit(100)

          if (evData && evData.length > 0) {
            const evMap = new Map<string, BotboxEv>()
            for (const item of evData as any[]) {
              const key = (item.product_type || '').toLowerCase()
              if (key && !evMap.has(key)) {
                evMap.set(key, {
                  product_name: item.product_type,
                  expected_value: item.expected_value ? parseFloat(String(item.expected_value)) : null,
                  ev_to_price_ratio: item.ev_to_price_ratio ? parseFloat(String(item.ev_to_price_ratio)) : null,
                })
              }
            }
            setBotboxEvs(evMap)
          } else {
            setBotboxEvs(new Map())
          }
        } catch {
          setBotboxEvs(new Map())
        }
      } else {
        setBotboxEvs(new Map())
      }
    } catch (err: any) {
      setSearchError(err.message || 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }, [selectedSetName, selectedSetType, selectedProductType, selectedFoil, marketSettings])

  // Sorting
  const requestSort = (key: SortKey) => {
    let direction: SortDirection = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const sortedOffers = useMemo(() => {
    let filtered = [...offers]
    if (stockFilter === 'In Stock') {
      filtered = filtered.filter(o => o.in_stock)
    }

    filtered.sort((a, b) => {
      let aValue: any = (a as any)[sortConfig.key]
      let bValue: any = (b as any)[sortConfig.key]

      if (sortConfig.key === 'shipping') {
        aValue = a.shipping ?? 0
        bValue = b.shipping ?? 0
      }
      if (sortConfig.key === 'total') {
        aValue = a.total ?? 0
        bValue = b.total ?? 0
      }
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      }
      if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
        const valA = aValue ? 1 : 0
        const valB = bValue ? 1 : 0
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA
      }
      if (sortConfig.key === 'fetched_at') {
        const dateA = new Date(aValue).getTime()
        const dateB = new Date(bValue).getTime()
        return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA
      }
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [offers, sortConfig, stockFilter])

  // Grouped offers for card view
  const groupedOffers = useMemo(() => {
    const groups: { [key: string]: PriceOffer[] } = {}
    sortedOffers.forEach(offer => {
      const key = `${offer.set_name || 'Unknown'}|${offer.product_type || 'Unknown'}`
      if (!groups[key]) groups[key] = []
      groups[key].push(offer)
    })
    return Object.entries(groups).map(([key, items]) => {
      const [set_name, product_type] = key.split('|')
      return { set_name, product_type, offers: items }
    })
  }, [sortedOffers])

  // Sort arrow
  const renderSortArrow = (columnKey: SortKey) => {
    if (sortConfig.key !== columnKey) return <span className="w-3 inline-block"></span>
    return <span className="ml-1 text-[10px] w-3 inline-block">{sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>
  }

  return (
    <div className="w-full animate-fade-in space-y-6">
      {/* Filter Bar */}
      <div className="bg-[#0f111a]/80 backdrop-blur-xl p-6 rounded-xl border border-white/10 shadow-2xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-1)]">Marketplace Price Comparison</h2>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-[var(--text-2)]"
          >
            Settings
          </button>
        </div>

        {/* Marketplace Settings Panel */}
        {showSettings && (
          <div className="mb-6 p-4 bg-black/40 rounded-xl border border-white/10">
            <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 uppercase tracking-wider">Marketplace Settings</h3>
            <div className="space-y-2">
              {marketSettings.map((setting, idx) => (
                <div key={setting.name} className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-center p-2 sm:p-0 bg-white/[0.02] sm:bg-transparent rounded-lg sm:rounded-none">
                  <span className="text-xs font-bold text-[var(--brand)] capitalize col-span-2 sm:col-span-1">{setting.name}</span>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-[var(--text-2)] uppercase shrink-0">Ship $</label>
                    <input
                      type="number"
                      step="0.01"
                      value={setting.shippingCost}
                      onChange={(e) => {
                        const updated = [...marketSettings]
                        updated[idx] = { ...setting, shippingCost: parseFloat(e.target.value) || 0 }
                        setMarketSettings(updated)
                      }}
                      className="w-full sm:w-20 bg-[var(--bg-2)] border border-white/20 rounded px-2 py-1 text-xs text-[var(--text-1)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-[var(--text-2)] uppercase shrink-0">Free $</label>
                    <input
                      type="number"
                      step="1"
                      value={setting.freeOver}
                      onChange={(e) => {
                        const updated = [...marketSettings]
                        updated[idx] = { ...setting, freeOver: parseFloat(e.target.value) || 0 }
                        setMarketSettings(updated)
                      }}
                      className="w-full sm:w-20 bg-[var(--bg-2)] border border-white/20 rounded px-2 py-1 text-xs text-[var(--text-1)]"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.taxed}
                      onChange={(e) => {
                        const updated = [...marketSettings]
                        updated[idx] = { ...setting, taxed: e.target.checked }
                        setMarketSettings(updated)
                      }}
                      className="rounded border-white/20"
                    />
                    <span className="text-[10px] text-[var(--text-2)] uppercase">Taxed</span>
                  </label>
                </div>
              ))}
            </div>
            <button
              onClick={saveSettings}
              className="mt-3 px-4 py-1.5 bg-[var(--brand)] text-white text-xs font-bold rounded-lg hover:bg-blue-500 transition-colors"
            >
              Save Settings
            </button>
          </div>
        )}

        {/* Filter Dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase mb-2 flex items-center gap-2">
              Select Set {isLoadingSets && <span className="w-2 h-2 border border-white/20 border-t-white rounded-full animate-spin inline-block"></span>}
            </label>
            <select
              value={selectedSetKey}
              onChange={(e) => setSelectedSetKey(e.target.value)}
              className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
            >
              <option value="Any|All Sets">Any Set (All Sets)</option>
              {availableSets.map((s, idx) => (
                <option key={idx} value={`${s.name}|${s.type}`}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase mb-2 flex items-center gap-2">
              Product Type {isLoadingProductTypes && <span className="w-2 h-2 border border-white/20 border-t-white rounded-full animate-spin inline-block"></span>}
            </label>
            <select
              value={selectedProductType}
              onChange={(e) => setSelectedProductType(e.target.value)}
              disabled={isLoadingProductTypes}
              className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              {availableProductTypes.map((pt, idx) => (
                <option key={idx} value={pt}>{pt}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[var(--text-2)] uppercase mb-2 flex items-center gap-2">
              Finish {isLoadingFoils && <span className="w-2 h-2 border border-white/20 border-t-white rounded-full animate-spin inline-block"></span>}
            </label>
            <select
              value={selectedFoil}
              onChange={(e) => setSelectedFoil(e.target.value)}
              disabled={isLoadingFoils}
              className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              {availableFoilTypes.map((f, idx) => (
                <option key={idx} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="w-full h-[38px] bg-[var(--brand)] hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all flex items-center justify-center shadow-lg text-sm"
          >
            {isSearching ? 'Searching...' : 'Search Prices'}
          </button>
        </div>
      </div>

      {/* Options Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-2">
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold text-[var(--text-2)] uppercase">View:</span>
          <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
            <button
              onClick={() => setViewMode('card')}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded transition-all ${viewMode === 'card' ? 'bg-[var(--brand)] text-white shadow-lg' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
            >
              Card
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded transition-all ${viewMode === 'list' ? 'bg-[var(--brand)] text-white shadow-lg' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
            >
              List
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[var(--text-2)] uppercase">Availability:</span>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as 'In Stock' | 'All')}
            className="bg-black/40 border border-white/10 rounded-lg p-1.5 text-xs text-[var(--text-1)] outline-none focus:border-[var(--brand)]"
          >
            <option value="In Stock">In Stock Only</option>
            <option value="All">All (Include Out of Stock)</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {searchError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-6 rounded-xl text-center">
          <p className="font-bold">{searchError}</p>
          <button onClick={handleSearch} className="mt-4 px-8 py-2 bg-[var(--brand)] rounded-lg hover:bg-blue-600 text-white text-sm font-bold">
            Retry Search
          </button>
        </div>
      )}

      {/* Results */}
      <div className="bg-[#0f111a]/80 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden min-h-[400px] relative">
        {isSearching && (
          <div className="absolute inset-0 z-20 bg-[#0f111a]/60 backdrop-blur-[2px] flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-[var(--brand)]/20 border-t-[var(--brand)] rounded-full animate-spin mb-4"></div>
            <p className="text-[var(--text-1)] font-bold animate-pulse">Searching Marketplaces...</p>
          </div>
        )}

        {viewMode === 'list' ? (
          /* --- LIST VIEW --- */
          <>
            {/* Desktop table (hidden on small screens) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-[var(--bg-2)]/80 text-[var(--text-2)] font-bold uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-white/5">
                  <tr>
                    <th className="pl-3 pr-1 py-3 w-8"></th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none" onClick={() => requestSort('set_name')}>
                      <div className="flex items-center gap-1">Product{renderSortArrow('set_name')}</div>
                    </th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none" onClick={() => requestSort('marketplace')}>
                      <div className="flex items-center gap-1">Marketplace{renderSortArrow('marketplace')}</div>
                    </th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none text-right" onClick={() => requestSort('price')}>
                      <div className="flex items-center gap-1 justify-end">Price{renderSortArrow('price')}</div>
                    </th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none text-right" onClick={() => requestSort('shipping')}>
                      <div className="flex items-center gap-1 justify-end">Ship{renderSortArrow('shipping')}</div>
                    </th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none text-right" onClick={() => requestSort('total')}>
                      <div className="flex items-center gap-1 justify-end">Total{renderSortArrow('total')}</div>
                    </th>
                    <th className="px-3 py-3 text-center">Status</th>
                    <th className="px-3 py-3 cursor-pointer hover:bg-white/10 transition-colors select-none text-center" onClick={() => requestSort('fetched_at')}>
                      <div className="flex items-center gap-1 justify-center">Updated{renderSortArrow('fetched_at')}</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sortedOffers.length > 0 ? (
                    sortedOffers.map((offer) => (
                      <tr key={offer.id} className={`group hover:bg-white/[0.03] transition-colors ${!offer.in_stock ? 'opacity-40' : ''}`}>
                        <td className="pl-3 pr-1 py-2.5 text-center">
                          {offer.set_name && offer.product_type && (
                            <button
                              onClick={() => toggleItem({
                                setName: offer.set_name!,
                                productType: offer.product_type!,
                                title: offer.title,
                                costPaid: offer.price,
                                count: 1,
                                feePercent: 13,
                                shippingCost: 5,
                              })}
                              className="p-0.5 hover:scale-110 transition-transform"
                              title={isInInventory(offer.set_name!, offer.product_type!) ? 'Remove from inventory' : 'Add to inventory'}
                            >
                              <svg className="w-3.5 h-3.5" fill={isInInventory(offer.set_name!, offer.product_type!) ? 'var(--brand)' : 'none'} stroke={isInInventory(offer.set_name!, offer.product_type!) ? 'var(--brand)' : 'currentColor'} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5 max-w-[280px]">
                          <div className="text-[var(--text-1)] font-medium truncate" title={offer.title}>
                            {offer.set_name || offer.title}
                          </div>
                          <div className="text-[10px] text-[var(--text-2)] truncate">
                            {offer.product_type || offer.title}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:text-[var(--brand)] transition-colors"
                          >
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(offer.url).hostname } catch { return '' } })()}&sz=16`}
                              alt=""
                              className="w-3.5 h-3.5 opacity-70 shrink-0"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                            <span className="font-bold text-[var(--brand)]">{offer.marketplace}</span>
                          </a>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-2)]">${offer.price.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-2)]">
                          {offer.shipping === null || offer.shipping === undefined ? '\u2014' : `$${offer.shipping.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold font-mono text-[var(--accent)]">
                          ${offer.total.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {offer.in_stock ? (
                              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" title="In Stock"></span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" title="Out of Stock"></span>
                            )}
                            {offer.isTaxed && (
                              <span className="text-[8px] font-bold text-amber-500" title="Taxed">T</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-[var(--text-2)] text-[10px] font-mono">
                          {offer.fetched_at ? new Date(offer.fetched_at).toLocaleDateString() : '\u2014'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    !isSearching && !searchError && (
                      <tr>
                        <td colSpan={8} className="px-3 py-32 text-center text-[var(--text-2)]">
                          Select filters above and click "Search Prices" to compare marketplace prices.
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile list (hidden on md+) */}
            <div className="md:hidden divide-y divide-white/5">
              {sortedOffers.length > 0 ? (
                sortedOffers.map((offer) => (
                  <div key={offer.id} className={`p-4 ${!offer.in_stock ? 'opacity-40' : ''}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-1)] truncate">{offer.set_name || offer.title}</div>
                        <div className="text-[10px] text-[var(--text-2)] truncate">{offer.product_type}</div>
                      </div>
                      {offer.set_name && offer.product_type && (
                        <button
                          onClick={() => toggleItem({
                            setName: offer.set_name!,
                            productType: offer.product_type!,
                            title: offer.title,
                            costPaid: offer.price,
                            count: 1,
                            feePercent: 13,
                            shippingCost: 5,
                          })}
                          className="p-1 shrink-0"
                        >
                          <svg className="w-4 h-4" fill={isInInventory(offer.set_name!, offer.product_type!) ? 'var(--brand)' : 'none'} stroke={isInInventory(offer.set_name!, offer.product_type!) ? 'var(--brand)' : 'currentColor'} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <a
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(offer.url).hostname } catch { return '' } })()}&sz=16`}
                          alt=""
                          className="w-3.5 h-3.5 opacity-70 shrink-0"
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                        <span className="font-bold text-[var(--brand)]">{offer.marketplace}</span>
                        {offer.isTaxed && <span className="text-[8px] font-bold text-amber-500 bg-amber-500/10 px-1 rounded">TAX</span>}
                        {!offer.in_stock && <span className="text-[8px] font-bold text-red-400 bg-red-500/10 px-1 rounded">OOS</span>}
                      </a>
                      <div className="text-right">
                        <div className="font-bold font-mono text-[var(--accent)] text-sm">${offer.total.toFixed(2)}</div>
                        {(offer.shipping ?? 0) > 0 && (
                          <div className="text-[10px] text-[var(--text-2)] font-mono">${offer.price.toFixed(2)} + ${(offer.shipping ?? 0).toFixed(2)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                !isSearching && !searchError && (
                  <div className="px-4 py-32 text-center text-[var(--text-2)] text-sm">
                    Select filters above and click "Search Prices" to compare marketplace prices.
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          /* --- CARD VIEW --- */
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {groupedOffers.length > 0 ? (
                groupedOffers.map((group, gIdx) => (
                  <div key={gIdx} className="bg-[#0f111a]/80 backdrop-blur-sm rounded-2xl border border-blue-500/10 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_0_20px_rgba(59,130,246,0.05)] hover:border-blue-500/30 hover:shadow-[0_8px_32px_rgba(59,130,246,0.1)] transition-all duration-300 group overflow-hidden flex flex-col">
                    {/* Product Image Area */}
                    <div className="aspect-[16/9] relative overflow-hidden bg-gradient-to-br from-blue-900/30 via-[#0b0d14] to-transparent">
                      {(() => {
                        const firstWithImage = group.offers.find(o => o.image_url)
                        if (firstWithImage && firstWithImage.image_url) {
                          return (
                            <img
                              src={firstWithImage.image_url}
                              alt={group.set_name}
                              className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
                            />
                          )
                        }
                        return (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4">
                            <div className="flex gap-2 flex-wrap justify-center">
                              {Array.from(new Set(group.offers.map(o => {
                                try { return new URL(o.url).hostname } catch { return '' }
                              }).filter(Boolean))).slice(0, 4).map((hostname, i) => (
                                <div key={i} className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                                  <img
                                    src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                                    alt=""
                                    className="w-6 h-6 opacity-60 group-hover:opacity-100 transition-opacity"
                                    onError={(e) => (e.currentTarget.style.display = 'none')}
                                  />
                                </div>
                              ))}
                            </div>
                            <span className="text-[9px] text-[var(--text-2)] uppercase tracking-widest font-bold opacity-40">
                              {group.offers.length} marketplace{group.offers.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        )
                      })()}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f111a] via-transparent to-transparent pointer-events-none" />
                      {/* Star icon for inventory */}
                      {group.set_name && group.product_type && group.set_name !== 'Unknown' && group.product_type !== 'Unknown' && (
                        <button
                          onClick={() => toggleItem({
                            setName: group.set_name,
                            productType: group.product_type,
                            title: group.offers[0]?.title || '',
                            costPaid: Math.min(...group.offers.map(o => o.total)),
                            count: 1,
                            feePercent: 13,
                            shippingCost: 5,
                          })}
                          className="absolute top-3 right-3 z-10 p-1.5 bg-black/40 backdrop-blur-sm rounded-full hover:scale-110 transition-transform"
                          title={isInInventory(group.set_name, group.product_type) ? 'Remove from inventory' : 'Add to inventory'}
                        >
                          <svg className="w-5 h-5" fill={isInInventory(group.set_name, group.product_type) ? 'var(--brand)' : 'none'} stroke={isInInventory(group.set_name, group.product_type) ? 'var(--brand)' : 'white'} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <div className="flex items-end justify-between gap-2">
                          <h3 className="text-sm font-bold text-white line-clamp-2 drop-shadow-lg" title={group.set_name}>
                            {group.set_name}
                          </h3>
                          <span className="text-[10px] font-bold text-white/70 uppercase shrink-0 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded">
                            {group.product_type}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Price List */}
                    <div className="p-3 space-y-1 flex-1">
                      {group.offers.map((offer) => (
                        <div key={offer.id} className="relative group/row">
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`block p-2 rounded hover:bg-white/5 transition-colors text-xs ${!offer.in_stock ? 'opacity-40' : ''}`}
                          >
                            <div className="text-[9px] text-[var(--text-2)] truncate mb-0.5" title={offer.title}>
                              {offer.title}
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(offer.url).hostname } catch { return '' } })()}&sz=16`}
                                  alt=""
                                  className="w-4 h-4 opacity-60 shrink-0"
                                  onError={(e) => (e.currentTarget.style.display = 'none')}
                                />
                                <span className="font-bold text-[var(--brand)]">{offer.marketplace}</span>
                                {offer.isTaxed && (
                                  <span className="text-[8px] font-bold text-amber-500 bg-amber-500/10 px-1 rounded">TAX</span>
                                )}
                                {!offer.in_stock && (
                                  <span className="text-[8px] font-bold text-red-400 bg-red-500/10 px-1 rounded">OOS</span>
                                )}
                              </div>
                              <span className="font-black font-mono text-[var(--accent)] text-sm">
                                ${offer.total.toFixed(2)}
                              </span>
                            </div>
                          </a>

                          {/* Hover tooltip */}
                          <div className="invisible group-hover/row:visible absolute bottom-full left-0 right-0 mb-2 p-3 bg-[#0a0c14] border border-white/10 rounded-lg shadow-2xl z-50 pointer-events-none min-w-[200px]">
                            <div className="space-y-1.5 text-[10px] uppercase font-bold tracking-tight">
                              <div className="mb-2 pb-1.5 border-b border-white/5 text-[var(--text-1)] normal-case line-clamp-2 text-xs">
                                {offer.title}
                              </div>
                              <div className="flex justify-between text-[var(--text-2)]">
                                <span>Base Price</span>
                                <span>${offer.price.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-[var(--text-2)]">
                                <span>Shipping</span>
                                <span>${(offer.shipping ?? 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-[var(--text-2)]">
                                <span>Tax Status</span>
                                <span className={offer.isTaxed ? 'text-amber-500' : 'text-slate-500'}>
                                  {offer.isTaxed ? 'TAXED' : 'NO TAX'}
                                </span>
                              </div>
                              <div className="pt-1.5 mt-1.5 border-t border-white/10 flex justify-between text-[var(--accent)] text-xs font-black">
                                <span>Total Landed</span>
                                <span>${offer.total.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* MTGStocks Reference Price */}
                    {(() => {
                      const ptKey = (group.product_type || '').toLowerCase()
                      const ref = mtgstocksRefs.get(ptKey)
                      if (!ref || (!ref.market_price && !ref.avg_price)) return null
                      const refPrice = ref.market_price ?? ref.avg_price
                      return (
                        <div className="px-3 py-1.5 border-t border-amber-500/10 bg-amber-500/[0.03]">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-bold text-amber-400/70 uppercase tracking-wider">Ref Price</span>
                              {ref.fetched_at && (
                                <span className="text-[8px] text-amber-400/40 font-mono">
                                  {new Date(ref.fetched_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <a
                              href={ref.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-bold font-mono text-amber-400 text-xs hover:text-amber-300 transition-colors"
                              title={`Avg: $${ref.avg_price?.toFixed(2) ?? 'N/A'} / Market: $${ref.market_price?.toFixed(2) ?? 'N/A'}${ref.fetched_at ? ` (${new Date(ref.fetched_at).toLocaleDateString()})` : ''}`}
                            >
                              ${refPrice!.toFixed(2)}
                            </a>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Card Footer */}
                    <div className="px-4 py-2 border-t border-white/5 bg-black/20">
                      <div className="flex justify-between items-center text-[10px] text-[var(--text-2)]">
                        <span>{group.offers.length} offer{group.offers.length !== 1 ? 's' : ''}</span>
                        <div className="flex items-center gap-3">
                          {(() => {
                            const pt = (group.product_type || '').toLowerCase()
                            if (!pt) return null
                            const match = botboxEvs.get(pt)
                            if (!match || !match.expected_value) return null
                            return (
                              <span className="font-bold text-purple-400" title={`EV | Ratio: ${match.ev_to_price_ratio?.toFixed(2) ?? 'N/A'}`}>
                                EV: ${match.expected_value.toFixed(2)}
                              </span>
                            )
                          })()}
                          {group.offers.length > 0 && (
                            <span className="font-bold text-green-400">
                              Best: ${Math.min(...group.offers.map(o => o.total)).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                !isSearching && !searchError && (
                  <div className="col-span-full py-32 text-center text-[var(--text-2)]">
                    Select filters above and click "Search Prices" to compare marketplace prices.
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      {offers.length > 0 && (
        <div className="text-center text-xs text-[var(--text-2)]">
          Showing {sortedOffers.length} of {offers.length} offers
          {stockFilter === 'In Stock' && offers.length !== sortedOffers.length && ` (${offers.length - sortedOffers.length} out of stock hidden)`}
        </div>
      )}
    </div>
  )
}
