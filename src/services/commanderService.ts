/**
 * Commander Service
 *
 * Handles all data fetching related to Commander preconstructed decks.
 * Provides deck listings, individual deck details, and card valuations.
 */

import { supabase } from './supabase'
import type {
  CommanderDeck,
  CommanderDeckValue,
  CommanderDeckCardDetail,
  CommanderDeckWithDetails,
} from '../types/models'

export const commanderService = {
  /**
   * Get all commander decks with their total values
   *
   * Uses the v_commander_deck_values view for efficient querying
   * with pre-calculated deck values.
   *
   * @returns Array of commander decks with values
   */
  async getAllDecks(): Promise<CommanderDeckValue[]> {
    try {
      const { data, error } = await supabase
        .from('v_commander_deck_values')
        .select('*')
        .order('deck_name', { ascending: true })

      if (error) {
        throw new Error(`Failed to fetch commander decks: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getAllDecks:', error)
      throw error
    }
  },

  /**
   * Get a single commander deck with basic info
   *
   * @param code - Deck code
   * @param fileName - Deck file name
   * @returns Commander deck or null
   */
  async getDeckInfo(code: string, fileName: string): Promise<CommanderDeck | null> {
    try {
      const { data, error } = await supabase
        .from('commander_decks')
        .select('*')
        .eq('code', code)
        .eq('file_name', fileName)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null
        }
        throw new Error(`Failed to fetch deck info: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error in getDeckInfo:', error)
      throw error
    }
  },

  /**
   * Get all cards in a commander deck with prices
   *
   * Uses the v_commander_deck_card_details view which includes
   * current card prices and calculates total card values.
   *
   * @param code - Deck code
   * @param fileName - Deck file name
   * @returns Array of deck cards with pricing details
   */
  async getDeckCards(code: string, fileName: string): Promise<CommanderDeckCardDetail[]> {
    try {
      const { data, error } = await supabase
        .from('v_commander_deck_card_details')
        .select('*')
        .eq('code', code)
        .eq('deck_name', fileName)
        .order('is_commander', { ascending: false }) // Show commander first
        .order('price', { ascending: false }) // Then by value

      if (error) {
        throw new Error(`Failed to fetch deck cards: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getDeckCards:', error)
      throw error
    }
  },

  /**
   * Get complete deck details with cards and value
   *
   * Combines deck info with card list and total value calculation.
   *
   * @param code - Deck code
   * @param fileName - Deck file name
   * @returns Complete deck details or null
   */
  async getDeckWithDetails(
    code: string,
    fileName: string
  ): Promise<CommanderDeckWithDetails | null> {
    try {
      // Fetch deck info and cards in parallel
      const [deckInfo, cards, deckValue] = await Promise.all([
        this.getDeckInfo(code, fileName),
        this.getDeckCards(code, fileName),
        supabase
          .from('v_commander_deck_values')
          .select('*')
          .eq('code', code)
          .eq('deck_name', fileName)
          .single(),
      ])

      if (!deckInfo) {
        return null
      }

      // Calculate total value from cards if view doesn't provide it
      const totalValue = deckValue.data?.total_value ??
        cards.reduce((sum, card) => sum + (card.total_card_value ?? 0), 0)

      const cardCount = deckValue.data?.card_count ?? cards.length

      return {
        ...deckInfo,
        cards,
        totalValue,
        cardCount,
        valueOver25c: deckValue.data?.value_over_25c ?? 0,
        valueOver1: deckValue.data?.value_over_1 ?? 0,
        cardsOver25c: deckValue.data?.cards_over_25c ?? 0,
        cardsOver1: deckValue.data?.cards_over_1 ?? 0,
      }
    } catch (error) {
      console.error('Error in getDeckWithDetails:', error)
      throw error
    }
  },

  /**
   * Search commander decks by name
   *
   * @param searchTerm - Search query
   * @returns Array of matching decks
   */
  async searchDecks(searchTerm: string): Promise<CommanderDeckValue[]> {
    try {
      const { data, error } = await supabase
        .from('v_commander_deck_values')
        .select('*')
        .ilike('deck_name', `%${searchTerm}%`)
        .order('deck_name', { ascending: true })

      if (error) {
        throw new Error(`Failed to search decks: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in searchDecks:', error)
      throw error
    }
  },

  /**
   * Get decks by release year
   *
   * @param year - Release year (e.g., 2024)
   * @returns Array of decks from that year
   */
  async getDecksByYear(year: number): Promise<CommanderDeck[]> {
    try {
      const { data, error } = await supabase
        .from('commander_decks')
        .select('*')
        .gte('release_date', `${year}-01-01`)
        .lt('release_date', `${year + 1}-01-01`)
        .order('release_date', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch decks by year: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getDecksByYear:', error)
      throw error
    }
  },

  /**
   * Get the most valuable commander decks
   *
   * @param limit - Number of decks to return
   * @returns Top valued decks
   */
  async getTopValuedDecks(limit: number = 10): Promise<CommanderDeckValue[]> {
    try {
      const { data, error } = await supabase
        .from('v_commander_deck_values')
        .select('*')
        .not('total_value', 'is', null)
        .order('total_value', { ascending: false })
        .limit(limit)

      if (error) {
        throw new Error(`Failed to fetch top valued decks: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error in getTopValuedDecks:', error)
      throw error
    }
  },
}
