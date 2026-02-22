/**
 * Offers Service
 *
 * Handles all data fetching related to product offers and pricing.
 * Uses Supabase views for optimal performance.
 */

import { supabase } from './supabase'
import type {
  OffersLatestEnriched,
  Offer,
  FilterState,
  FilterOptions,
} from '../types/models'

export const offersService = {
  /**
   * Fetch latest offers with enriched data (uses view: offers_latest_enriched)
   *
   * This view provides the latest offer per canonical_sku + marketplace with
   * product metadata for efficient querying.
   *
   * @param filters - Optional filters to apply
   * @returns Array of enriched offers
   */
  async getLatestOffers(filters?: FilterState): Promise<OffersLatestEnriched[]> {
    try {
      let query = supabase
        .from('offers_latest_enriched')
        .select('*')

      // Apply filters if provided
      if (filters?.selectedSet) {
        query = query.eq('set_name', filters.selectedSet)
      }

      if (filters?.productType) {
        query = query.eq('product_type', filters.productType)
      }

      if (filters?.foilVariant) {
        query = query.eq('foil', filters.foilVariant)
      }

      if (filters?.marketplace) {
        query = query.eq('marketplace', filters.marketplace)
      }

      if (filters?.searchTerm && filters.searchTerm.trim()) {
        query = query.ilike('title', `%${filters.searchTerm}%`)
      }

      if (filters?.inStockOnly) {
        query = query.eq('in_stock', true)
      }

      if (filters?.priceRange) {
        if (filters.priceRange.min !== undefined) {
          query = query.gte('price', filters.priceRange.min)
        }
        if (filters.priceRange.max !== undefined) {
          query = query.lte('price', filters.priceRange.max)
        }
      }

      // Order by price ascending by default
      query = query.order('price', { ascending: true })

      const { data, error } = await query

      if (error) {
        console.error('Error fetching latest offers:', error)
        throw new Error(`Failed to fetch offers: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getLatestOffers:', error)
      throw error
    }
  },

  /**
   * Get filter options for the offers table
   *
   * Fetches distinct values for sets, product types, and foil variants
   * from pre-computed dropdown views for fast filter rendering.
   *
   * @returns Filter options object
   */
  async getFilterOptions(): Promise<FilterOptions> {
    try {
      const [setsRes, productsRes, foilRes] = await Promise.all([
        supabase.from('offers_dropdown_sets').select('*').order('set_name'),
        supabase.from('offers_dropdown_product_types').select('*').order('product_type'),
        supabase.from('offers_dropdown_foil').select('*').order('foil'),
      ])

      if (setsRes.error) {
        throw new Error(`Failed to fetch sets: ${setsRes.error.message}`)
      }
      if (productsRes.error) {
        throw new Error(`Failed to fetch product types: ${productsRes.error.message}`)
      }
      if (foilRes.error) {
        throw new Error(`Failed to fetch foil variants: ${foilRes.error.message}`)
      }

      // Get distinct marketplaces from the latest offers
      const { data: marketplacesData, error: marketplacesError } = await supabase
        .from('offers_latest_enriched')
        .select('marketplace')
        .not('marketplace', 'is', null)

      if (marketplacesError) {
        throw new Error(`Failed to fetch marketplaces: ${marketplacesError.message}`)
      }

      // Extract unique marketplace names
      const marketplacesList = (marketplacesData ?? []) as any[]
      const uniqueMarketplaces = Array.from(
        new Set(marketplacesList.map((item) => item.marketplace).filter(Boolean) as string[])
      ).sort()

      return {
        sets: setsRes.data || [],
        productTypes: productsRes.data || [],
        foilVariants: foilRes.data || [],
        marketplaces: uniqueMarketplaces,
      }
    } catch (error) {
      console.error('Error in getFilterOptions:', error)
      throw error
    }
  },

  /**
   * Get price comparison data for a specific product
   *
   * Fetches all offers for a canonical SKU to show price comparison
   * across different marketplaces.
   *
   * @param canonicalSku - The unique product identifier
   * @returns Array of offers for the product
   */
  async getPriceComparison(canonicalSku: string): Promise<Offer[]> {
    try {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('canonical_sku', canonicalSku)
        .eq('scrape_ok', true) // Only successful scrapes
        .order('price', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch price comparison: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getPriceComparison:', error)
      throw error
    }
  },

  /**
   * Get price history for a product
   *
   * Fetches historical pricing data for trend analysis.
   *
   * @param canonicalSku - The unique product identifier
   * @param marketplace - Optional marketplace filter
   * @param limit - Maximum number of records to return
   * @returns Array of historical offers
   */
  async getPriceHistory(
    canonicalSku: string,
    marketplace?: string,
    limit: number = 50
  ): Promise<Offer[]> {
    try {
      let query = supabase
        .from('offers')
        .select('*')
        .eq('canonical_sku', canonicalSku)
        .eq('scrape_ok', true)
        .order('fetched_at', { ascending: false })
        .limit(limit)

      if (marketplace) {
        query = query.eq('marketplace', marketplace)
      }

      const { data, error } = await query

      if (error) {
        throw new Error(`Failed to fetch price history: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getPriceHistory:', error)
      throw error
    }
  },

  /**
   * Get a single offer by ID
   *
   * @param offerId - The offer UUID
   * @returns Single offer or null
   */
  async getOfferById(offerId: string): Promise<Offer | null> {
    try {
      const { data, error } = await supabase
        .from('offers')
        .select('*')
        .eq('id', offerId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null
        }
        throw new Error(`Failed to fetch offer: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error in getOfferById:', error)
      throw error
    }
  },
}
