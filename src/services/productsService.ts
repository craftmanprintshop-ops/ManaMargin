/**
 * Products Service
 *
 * Handles all data fetching related to tracked products.
 * Provides product catalog and metadata operations.
 */

import { supabase } from './supabase'
import type { TrackedProduct } from '../types/models'

export const productsService = {
  /**
   * Get all active tracked products
   *
   * @returns Array of active products
   */
  async getActiveProducts(): Promise<TrackedProduct[]> {
    try {
      const { data, error } = await supabase
        .from('tracked_products')
        .select('*')
        .eq('active', true)
        .order('display_name', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch products: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getActiveProducts:', error)
      throw error
    }
  },

  /**
   * Get a product by canonical SKU
   *
   * @param canonicalSku - Unique product identifier
   * @returns Product or null
   */
  async getProductBySku(canonicalSku: string): Promise<TrackedProduct | null> {
    try {
      const { data, error } = await supabase
        .from('tracked_products')
        .select('*')
        .eq('canonical_sku', canonicalSku)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        throw new Error(`Failed to fetch product: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error in getProductBySku:', error)
      throw error
    }
  },

  /**
   * Search products by name
   *
   * @param searchTerm - Search query
   * @param activeOnly - Only return active products
   * @returns Array of matching products
   */
  async searchProducts(
    searchTerm: string,
    activeOnly: boolean = true
  ): Promise<TrackedProduct[]> {
    try {
      let query = supabase
        .from('tracked_products')
        .select('*')
        .ilike('display_name', `%${searchTerm}%`)

      if (activeOnly) {
        query = query.eq('active', true)
      }

      query = query.order('display_name', { ascending: true })

      const { data, error } = await query

      if (error) {
        throw new Error(`Failed to search products: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in searchProducts:', error)
      throw error
    }
  },
}
