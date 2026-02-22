/**
 * Dashboard Service
 *
 * Handles data fetching for dashboard statistics and overview.
 * Provides summary counts, trends, and featured content.
 */

import { supabase } from './supabase'

export const dashboardService = {
  /**
   * Get total count of products being tracked
   *
   * Queries the offers table to count distinct products
   */
  async getTotalProductsCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('offers_latest_enriched')
        .select('*', { count: 'exact', head: true })

      if (error) {
        console.error('Error fetching products count:', error)
        return 0
      }

      return count || 0
    } catch (error) {
      console.error('Error in getTotalProductsCount:', error)
      return 0
    }
  },

  /**
   * Get total count of latest offers
   *
   * Counts all current price points across retailers
   */
  async getTotalOffersCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('offers')
        .select('*', { count: 'exact', head: true })
        .gte('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days

      if (error) {
        console.error('Error fetching offers count:', error)
        return 0
      }

      return count || 0
    } catch (error) {
      console.error('Error in getTotalOffersCount:', error)
      return 0
    }
  },

  /**
   * Get total count of commander decks
   *
   * Queries commander_deck_info table
   */
  async getCommanderDecksCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('commander_deck_info')
        .select('*', { count: 'exact', head: true })

      if (error) {
        console.error('Error fetching commander decks count:', error)
        return 0
      }

      return count || 0
    } catch (error) {
      console.error('Error in getCommanderDecksCount:', error)
      return 0
    }
  },

  /**
   * Get total count of unique cards in database
   */
  async getTotalCardsCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })

      if (error) {
        console.error('Error fetching cards count:', error)
        return 0
      }

      return count || 0
    } catch (error) {
      console.error('Error in getTotalCardsCount:', error)
      return 0
    }
  },

  /**
   * Get recent price movers (products with significant price changes)
   *
   * Uses v_movers_24h view if available, otherwise falls back to basic query
   */
  async getRecentMovers(limit: number = 10) {
    try {
      // Try to use v_movers_24h view
      const { data, error } = await supabase
        .from('v_movers_24h')
        .select('*')
        .limit(limit)

      if (error) {
        // View might not exist, return empty array
        console.warn('v_movers_24h view not available:', error.message)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getRecentMovers:', error)
      return []
    }
  },

  /**
   * Get featured/popular sets
   *
   * Returns sets with the most tracked products
   */
  async getFeaturedSets(limit: number = 5): Promise<Array<{ set_name: string; count: number }>> {
    try {
      const { data, error } = await supabase
        .from('offers_latest_enriched')
        .select('set_name')
        .not('set_name', 'is', null)
        .limit(1000)

      if (error) {
        console.error('Error fetching featured sets:', error)
        return []
      }

      // Count occurrences of each set
      const setCounts = new Map<string, number>()
      data?.forEach((item) => {
        if (item.set_name) {
          setCounts.set(item.set_name, (setCounts.get(item.set_name) || 0) + 1)
        }
      })

      // Convert to array and sort by count
      const sortedSets = Array.from(setCounts.entries())
        .map(([set_name, count]) => ({ set_name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)

      return sortedSets
    } catch (error) {
      console.error('Error in getFeaturedSets:', error)
      return []
    }
  },

  /**
   * Get low stock alerts
   *
   * Returns products that are low in stock across retailers
   */
  async getLowStockProducts(limit: number = 10) {
    try {
      const { data, error } = await supabase
        .from('offers_latest_enriched')
        .select('*')
        .in('stock_status', ['low_stock', 'last_few'])
        .order('price', { ascending: false })
        .limit(limit)

      if (error) {
        console.error('Error fetching low stock products:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getLowStockProducts:', error)
      return []
    }
  },

  /**
   * Get dashboard summary
   *
   * Fetches all dashboard statistics in one call
   */
  async getDashboardSummary() {
    try {
      const [
        totalProducts,
        totalOffers,
        commanderDecks,
        totalCards,
        featuredSets,
        recentMovers,
        lowStockProducts,
      ] = await Promise.all([
        this.getTotalProductsCount(),
        this.getTotalOffersCount(),
        this.getCommanderDecksCount(),
        this.getTotalCardsCount(),
        this.getFeaturedSets(5),
        this.getRecentMovers(5),
        this.getLowStockProducts(5),
      ])

      return {
        totalProducts,
        totalOffers,
        commanderDecks,
        totalCards,
        featuredSets,
        recentMovers,
        lowStockProducts,
      }
    } catch (error) {
      console.error('Error in getDashboardSummary:', error)
      throw error
    }
  },
}
