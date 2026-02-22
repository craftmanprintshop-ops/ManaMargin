/**
 * Pack Simulator Service
 *
 * Handles the logic for virtual booster pack opening and EV calculations.
 * Simulates realistic pack openings with rarity distribution and pricing.
 */

import { supabase } from './supabase'
import { cardsService } from './cardsService'
import type {
  PackCard,
  PackOpeningResult,
  SimulationResults,
  CardsBySetRarity,
} from '../types/models'
import { DEFAULT_PACK_STRUCTURE } from '../utils/constants'

export const packSimulatorService = {
  /**
   * Get available sets from the database
   *
   * Queries the cards table to find which sets actually have cards
   */
  async getAvailableSets(): Promise<string[]> {
    try {
      console.log('Fetching available sets from cards table...')

      // First, try to count total cards to see if table has data
      const { count: totalCards, error: countError } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })

      console.log(`Total cards in database: ${totalCards}`)

      if (countError) {
        console.error('Error counting cards:', countError)
        console.error('RLS Policy might be blocking access. Error details:', {
          message: countError.message,
          code: countError.code,
          hint: countError.hint,
          details: countError.details
        })
      }

      // Now fetch set codes
      const { data, error } = await supabase
        .from('cards')
        .select('set_code')
        .not('set_code', 'is', null)
        .limit(1000)

      if (error) {
        console.error('Error fetching sets:', error)
        console.error('Full error details:', {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details
        })
        throw new Error(`Failed to fetch available sets: ${error.message}. Check console for details.`)
      }

      console.log(`Fetched ${data?.length || 0} cards with set_code values`)

      if (!data || data.length === 0) {
        console.warn('No cards found with set_code values in the database')
        return []
      }

      // Get unique set codes and sort them
      const cardData = (data ?? []) as any[]
      const uniqueSets = [...new Set(cardData.map((card) => card.set_code).filter(Boolean))]
      console.log(`Found ${uniqueSets.length} unique sets:`, uniqueSets)
      return uniqueSets.sort()
    } catch (error) {
      console.error('Error in getAvailableSets:', error)
      throw error
    }
  },

  /**
   * Open a single booster pack
   *
   * Simulates opening one booster pack from a given set.
   * Uses rarity distribution and current card prices.
   *
   * Standard pack structure:
   * - 1 rare or mythic (mythic ~12.5% of the time)
   * - 3 uncommons
   * - 10 commons
   * - Optional: 1 foil card (25% chance)
   *
   * @param setCode - MTG set code (e.g., "MH3", "BRO")
   * @returns Pack opening result with cards and value
   */
  async openPack(setCode: string): Promise<PackOpeningResult> {
    try {
      console.log(`Opening pack for set: ${setCode}`)

      const cards: PackCard[] = []

      // Fetch all cards from the set grouped by rarity
      const [commons, uncommons, rares, mythics] = await Promise.all([
        cardsService.getCardsBySetRarity(setCode, 'common'),
        cardsService.getCardsBySetRarity(setCode, 'uncommon'),
        cardsService.getCardsBySetRarity(setCode, 'rare'),
        cardsService.getCardsBySetRarity(setCode, 'mythic'),
      ])

      console.log(`Set ${setCode} card counts:`, {
        commons: commons.length,
        uncommons: uncommons.length,
        rares: rares.length,
        mythics: mythics.length,
      })

      // Check if we have cards
      if (commons.length === 0 && uncommons.length === 0 && rares.length === 0) {
        throw new Error(`No cards found for set code: ${setCode}. This set may not be in your database.`)
      }

      // Add 10 commons (or as many as we have)
      const commonCount = Math.min(DEFAULT_PACK_STRUCTURE.COMMONS, commons.length)
      for (let i = 0; i < commonCount; i++) {
        if (commons.length > 0) {
          const card = this.getRandomCard(commons)
          cards.push(await this.createPackCard(card, false))
        }
      }

      // Add 3 uncommons (or as many as we have)
      const uncommonCount = Math.min(DEFAULT_PACK_STRUCTURE.UNCOMMONS, uncommons.length)
      for (let i = 0; i < uncommonCount; i++) {
        if (uncommons.length > 0) {
          const card = this.getRandomCard(uncommons)
          cards.push(await this.createPackCard(card, false))
        }
      }

      // Add 1 rare or mythic
      const isMythic = Math.random() < DEFAULT_PACK_STRUCTURE.MYTHIC_RATE
      const rarePool = isMythic && mythics.length > 0 ? mythics : rares

      if (rarePool.length > 0) {
        const card = this.getRandomCard(rarePool)
        cards.push(await this.createPackCard(card, false))
      } else {
        console.warn(`No rares or mythics found for set ${setCode}`)
      }

      // 25% chance for a foil card
      if (Math.random() < DEFAULT_PACK_STRUCTURE.FOIL_CHANCE) {
        const allCards = [...commons, ...uncommons, ...rares, ...mythics]
        if (allCards.length > 0) {
          const card = this.getRandomCard(allCards)
          cards.push(await this.createPackCard(card, true))
        }
      }

      // Calculate total pack value
      const totalValue = cards.reduce((sum, card) => sum + card.price, 0)

      console.log(`Pack opened: ${cards.length} cards, total value: $${totalValue.toFixed(2)}`)

      return {
        cards,
        totalValue,
        rareCards: cards.filter((c) => c.rarity === 'rare' || c.rarity === 'mythic'),
        foilCards: cards.filter((c) => c.foil),
      }
    } catch (error) {
      console.error('Error in openPack:', error)
      throw error
    }
  },

  /**
   * Get a random card from an array
   */
  getRandomCard(cards: CardsBySetRarity[]): CardsBySetRarity {
    const index = Math.floor(Math.random() * cards.length)
    return cards[index]
  },

  /**
   * Create a PackCard with pricing data
   */
  async createPackCard(
    card: CardsBySetRarity,
    foil: boolean
  ): Promise<PackCard> {
    // Get price for the card
    const cardData = card as any
    let price = 0
    if (cardData.uuid) {
      try {
        const priceData = await cardsService.getCardPrice(cardData.uuid)
        price = priceData?.price || 0
      } catch (error) {
        // Price not available, use 0
      }
    }

    // Foil cards are typically worth more (multiply by 2 as estimate)
    if (foil && price > 0) {
      price = price * 2
    }

    return {
      uuid: cardData.uuid || '',
      name: cardData.name || 'Unknown Card',
      rarity: card.rarity || 'common',
      price,
      foil,
      set_code: card.set_code || '',
    }
  },

  /**
   * Open multiple packs and calculate statistics
   *
   * Runs a simulation of opening N packs and provides EV statistics.
   *
   * @param setCode - MTG set code
   * @param packCount - Number of packs to open
   * @returns Simulation results with statistics
   */
  async simulateMultiplePacks(
    setCode: string,
    packCount: number
  ): Promise<SimulationResults> {
    try {
      console.log(`Starting simulation: ${packCount} packs of ${setCode}`)
      const packs: PackOpeningResult[] = []

      // Open each pack sequentially
      for (let i = 0; i < packCount; i++) {
        const pack = await this.openPack(setCode)
        packs.push(pack)
      }

      // Calculate statistics
      const values = packs.map((p) => p.totalValue)
      const sortedValues = [...values].sort((a, b) => a - b)

      const averageValue = values.reduce((sum, v) => sum + v, 0) / packCount
      const medianValue = sortedValues[Math.floor(packCount / 2)] || 0
      const highestValue = Math.max(...values, 0)
      const lowestValue = Math.min(...values, 0)

      console.log(`Simulation complete. Average EV: $${averageValue.toFixed(2)}`)

      return {
        packs,
        averageValue,
        medianValue,
        highestValue,
        lowestValue,
        totalPacks: packCount,
      }
    } catch (error) {
      console.error('Error in simulateMultiplePacks:', error)
      throw error
    }
  },
}
