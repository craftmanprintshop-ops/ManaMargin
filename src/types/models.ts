/**
 * Domain Models and Types
 *
 * This file extracts and extends types from the database schema
 * for easier use throughout the application.
 */

import type { Database } from './database'

// ============================================================================
// Database Table Types
// ============================================================================

export type Offer = Database['public']['Tables']['offers']['Row']
export type TrackedProduct = Database['public']['Tables']['tracked_products']['Row']
export type Card = Database['public']['Tables']['cards']['Row']
export type CommanderDeck = Database['public']['Tables']['commander_decks']['Row']
export type CommanderDeckCard = Database['public']['Tables']['commander_deck_cards']['Row']

// ============================================================================
// Database View Types
// ============================================================================

export type OffersLatestEnriched = Database['public']['Views']['offers_latest_enriched']['Row']
export type OffersDropdownSets = Database['public']['Views']['offers_dropdown_sets']['Row']
export type OffersDropdownProductTypes = Database['public']['Views']['offers_dropdown_product_types']['Row']
export type OffersDropdownFoil = Database['public']['Views']['offers_dropdown_foil']['Row']
export type CommanderDeckValue = Database['public']['Views']['v_commander_deck_values']['Row']
export type CommanderDeckCardDetail = Database['public']['Views']['v_commander_deck_card_details']['Row']
export type CardsBySetRarity = Database['public']['Views']['v_cards_by_set_rarity']['Row']
export type CardLatestPrice = Database['public']['Views']['v_card_latest_price']['Row']

// ============================================================================
// Extended/Composite Types
// ============================================================================

/**
 * Product with offers and price information
 */
export interface ProductWithOffers extends TrackedProduct {
  offers?: Offer[]
  latestPrice?: number
  lowestPrice?: number
  highestPrice?: number
  averagePrice?: number
  priceHistory?: Array<{
    date: string
    price: number
    marketplace: string
  }>
}

/**
 * Commander deck with full details including cards and value
 */
export interface CommanderDeckWithDetails extends CommanderDeck {
  cards?: CommanderDeckCardDetail[]
  totalValue?: number
  cardCount?: number
  valueOver25c?: number
  valueOver1?: number
  cardsOver25c?: number
  cardsOver1?: number
}

/**
 * Card with current pricing information
 */
export interface CardWithPrice extends Card {
  price?: number
  priceDate?: string
  finish?: 'normal' | 'foil' | 'etched'
}

/**
 * Pack opening result
 */
export interface PackCard {
  uuid: string
  name: string
  rarity: string
  price: number
  foil: boolean
  set_code: string
}

export interface PackOpeningResult {
  cards: PackCard[]
  totalValue: number
  rareCards: PackCard[]
  foilCards: PackCard[]
}

export interface SimulationResults {
  packs: PackOpeningResult[]
  averageValue: number
  medianValue: number
  highestValue: number
  lowestValue: number
  totalPacks: number
}

// ============================================================================
// UI State Types
// ============================================================================

/**
 * Filter state for products/offers pages
 */
export interface FilterState {
  searchTerm: string
  selectedSet?: string
  productType?: string
  foilVariant?: string
  marketplace?: string
  priceRange?: {
    min: number
    max: number
  }
  inStockOnly?: boolean
}

/**
 * Sort configuration
 */
export interface SortConfig {
  field: string
  order: 'asc' | 'desc'
}

/**
 * Pagination state
 */
export interface PaginationState {
  currentPage: number
  pageSize: number
  totalItems: number
  totalPages: number
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Generic paginated response
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationState
}

/**
 * API error response
 */
export interface ErrorResponse {
  error: string
  code: string
  details?: Record<string, unknown>
  timestamp?: string
}

/**
 * Filter options response
 */
export interface FilterOptions {
  sets: OffersDropdownSets[]
  productTypes: OffersDropdownProductTypes[]
  foilVariants: OffersDropdownFoil[]
  marketplaces: string[]
}

// ============================================================================
// Component Props Types
// ============================================================================

/**
 * Common props for list components
 */
export interface ListComponentProps<T> {
  items: T[]
  loading?: boolean
  error?: string | null
  onItemClick?: (item: T) => void
}

/**
 * Common props for filter components
 */
export interface FilterComponentProps {
  filters: FilterState
  options: FilterOptions
  onFilterChange: (key: keyof FilterState, value: unknown) => void
  onReset: () => void
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make all properties of T optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Extract non-nullable properties
 */
export type NonNullableFields<T> = {
  [P in keyof T]-?: NonNullable<T[P]>
}

/**
 * Marketplace names
 */
export type Marketplace =
  | 'ForgeAndFire'
  | 'CollectorStore'
  | 'MinMaxGames'
  | 'GameNerdz'
  | 'SagaConcepts'
  | 'GeekeryGames'
  | 'HobbyGamesApp'
  | 'TCGPlayer'
  | 'eBay'
  | 'Amazon'

/**
 * Product categories
 */
export type ProductCategory =
  | 'booster_box'
  | 'booster_pack'
  | 'bundle'
  | 'deck'
  | 'prerelease'
  | 'other'

/**
 * Card rarities
 */
export type CardRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'mythic'
  | 'special'

/**
 * Foil variants
 */
export type FoilVariant =
  | 'nonfoil'
  | 'foil'
  | 'etched'
  | 'showcase'
