/**
 * Cards Service
 *
 * Handles all data fetching related to individual Magic: The Gathering cards.
 * Provides card lookups, pricing, and set-based queries.
 */

import { supabase } from './supabase'
import type {
  Card,
  CardWithPrice,
  CardLatestPrice,
  CardsBySetRarity,
} from '../types/models'

export const cardsService = {
  /**
   * Get all cards from a specific set
   *
   * @param setCode - MTG set code (e.g., "MH3", "BRO")
   * @returns Array of cards from the set
   */
  async getCardsBySet(setCode: string): Promise<Card[]> {
    try {
      const { data, error} = await supabase
        .from('cards')
        .select('*')
        .eq('set_code', setCode)
        .order('rarity', { ascending: false })
        .order('name', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch cards by set: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getCardsBySet:', error)
      throw error
    }
  },

  /**
   * Get cards grouped by set and rarity (for pack simulator)
   *
   * Uses the v_cards_by_set_rarity view
   *
   * @param setCode - MTG set code
   * @param rarity - Optional rarity filter
   * @returns Array of cards
   */
  async getCardsBySetRarity(
    setCode: string,
    rarity?: string
  ): Promise<CardsBySetRarity[]> {
    try {
      let query = supabase
        .from('v_cards_by_set_rarity')
        .select('*')
        .eq('set_code', setCode)

      if (rarity) {
        query = query.eq('rarity', rarity)
      }

      const { data, error } = await query

      if (error) {
        throw new Error(`Failed to fetch cards by rarity: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getCardsBySetRarity:', error)
      throw error
    }
  },

  /**
   * Get current price for a card
   *
   * Uses the v_card_latest_price view
   *
   * @param uuid - Card UUID
   * @returns Card price info or null
   */
  async getCardPrice(uuid: string): Promise<CardLatestPrice | null> {
    try {
      const { data, error } = await supabase
        .from('v_card_latest_price')
        .select('*')
        .eq('uuid', uuid)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No price data available
          return null
        }
        throw new Error(`Failed to fetch card price: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error in getCardPrice:', error)
      throw error
    }
  },

  /**
   * Get multiple card prices at once
   *
   * Efficiently fetches prices for multiple cards
   *
   * @param uuids - Array of card UUIDs
   * @returns Map of UUID to price
   */
  async getCardPrices(uuids: string[]): Promise<Map<string, number>> {
    try {
      const { data, error } = await supabase
        .from('v_card_latest_price')
        .select('*')
        .in('uuid', uuids)

      if (error) {
        throw new Error(`Failed to fetch card prices: ${error.message}`)
      }

      const priceMap = new Map<string, number>()
      const priceData = (data ?? []) as any[]
      priceData.forEach((item) => {
        if (item.uuid && item.price !== null) {
          priceMap.set(item.uuid, item.price)
        }
      })

      return priceMap
    } catch (error) {
      console.error('Error in getCardPrices:', error)
      throw error
    }
  },

  /**
   * Search for cards by name
   *
   * @param searchTerm - Card name search query
   * @param limit - Maximum results
   * @returns Array of matching cards
   */
  async searchCards(searchTerm: string, limit: number = 20): Promise<Card[]> {
    try {
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .ilike('name', `%${searchTerm}%`)
        .limit(limit)
        .order('name', { ascending: true })

      if (error) {
        throw new Error(`Failed to search cards: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in searchCards:', error)
      throw error
    }
  },

  /**
   * Get a single card by UUID
   *
   * @param uuid - Card UUID
   * @returns Card or null
   */
  async getCardByUuid(uuid: string): Promise<Card | null> {
    try {
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .eq('uuid', uuid)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        throw new Error(`Failed to fetch card: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error in getCardByUuid:', error)
      throw error
    }
  },

  /**
   * Get card with current price
   *
   * Combines card info with latest price
   *
   * @param uuid - Card UUID
   * @returns Card with price or null
   */
  async getCardWithPrice(uuid: string): Promise<CardWithPrice | null> {
    try {
      const [card, priceInfo] = await Promise.all([
        this.getCardByUuid(uuid),
        this.getCardPrice(uuid),
      ])

      if (!card) {
        return null
      }

      return {
        ...card,
        price: priceInfo?.price ?? undefined,
      }
    } catch (error) {
      console.error('Error in getCardWithPrice:', error)
      throw error
    }
  },
}
