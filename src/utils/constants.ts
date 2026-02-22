/**
 * Application Constants
 *
 * Centralized constants used throughout the application.
 * Includes marketplace names, product types, pack simulator options, etc.
 */

/**
 * Supported marketplaces for price comparison
 */
export const MARKETPLACES = [
  'ForgeAndFire',
  'CollectorStore',
  'MinMaxGames',
  'GameNerdz',
  'SagaConcepts',
  'GeekeryGames',
  'HobbyGamesApp',
  'TCGPlayer',
  'eBay',
  'Amazon',
] as const

/**
 * Product categories
 */
export const PRODUCT_CATEGORIES = {
  BOOSTER_BOX: 'booster_box',
  BOOSTER_PACK: 'booster_pack',
  COLLECTOR_BOOSTER: 'collector_booster',
  SET_BOOSTER: 'set_booster',
  DRAFT_BOOSTER: 'draft_booster',
  BUNDLE: 'bundle',
  PRERELEASE_KIT: 'prerelease',
  COMMANDER_DECK: 'deck',
  OTHER: 'other',
} as const

/**
 * Card rarities
 */
export const RARITIES = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  MYTHIC: 'mythic',
  SPECIAL: 'special',
} as const

/**
 * Foil variants
 */
export const FOIL_VARIANTS = {
  NONFOIL: 'nonfoil',
  FOIL: 'foil',
  ETCHED: 'etched',
  SHOWCASE: 'showcase',
} as const

/**
 * Pack simulation options (number of packs to simulate)
 */
export const PACK_SIMULATION_OPTIONS = [10, 20, 30, 40, 50] as const

/**
 * Default pack structure (standard booster)
 */
export const DEFAULT_PACK_STRUCTURE = {
  COMMONS: 10,
  UNCOMMONS: 3,
  RARES: 1, // Includes mythics
  BASIC_LAND: 1,
  FOIL_CHANCE: 0.25, // 25% chance per pack
  MYTHIC_RATE: 0.125, // 1 in 8 rares is a mythic
} as const

/**
 * Pagination defaults
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  MAX_PAGE_SIZE: 100,
} as const

/**
 * API and query limits
 */
export const QUERY_LIMITS = {
  OFFERS_LIMIT: 1000,
  PRODUCTS_LIMIT: 500,
  CARDS_LIMIT: 100,
  SEARCH_RESULTS_LIMIT: 20,
  PRICE_HISTORY_LIMIT: 50,
} as const

/**
 * Date ranges for filtering
 */
export const DATE_RANGES = {
  LAST_24_HOURS: 1,
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
} as const

/**
 * Sort order options
 */
export const SORT_ORDERS = {
  ASCENDING: 'asc',
  DESCENDING: 'desc',
} as const

/**
 * MTG mana colors
 */
export const MANA_COLORS = {
  WHITE: 'W',
  BLUE: 'U',
  BLACK: 'B',
  RED: 'R',
  GREEN: 'G',
  COLORLESS: 'C',
} as const

/**
 * Color names for UI display
 */
export const MANA_COLOR_NAMES = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
} as const

/**
 * Tailwind color classes for mana colors
 */
export const MANA_COLOR_CLASSES = {
  W: 'bg-mana-white',
  U: 'bg-mana-blue',
  B: 'bg-mana-black',
  R: 'bg-mana-red',
  G: 'bg-mana-green',
  C: 'bg-gray-400',
} as const

/**
 * Stock status display values
 */
export const STOCK_STATUS = {
  IN_STOCK: 'In Stock',
  OUT_OF_STOCK: 'Out of Stock',
  UNKNOWN: 'Unknown',
} as const

/**
 * Application routes
 */
export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  PRODUCTS: '/products',
  PRICE_COMPARE: '/price-compare',
  EV_CALCULATIONS: '/ev-calculations',
  COMMANDER_DECKS: '/commander-decks',
  COMMANDER_DECK_DETAIL: '/commander-decks/:code/:fileName',
  INVENTORY: '/inventory',
  PRODUCT_NAME_STANDARDIZATION: '/admin/product-names',
  NOT_FOUND: '*',
} as const

/**
 * Local storage keys
 */
export const STORAGE_KEYS = {
  FILTERS: 'manamargin_filters',
  PAGE_SIZE: 'manamargin_page_size',
  THEME: 'manamargin_theme',
  FAVORITES: 'manamargin_favorites',
} as const

/**
 * External URLs
 */
export const EXTERNAL_URLS = {
  TCGPLAYER_BASE: 'https://www.tcgplayer.com',
  SCRYFALL_BASE: 'https://scryfall.com',
  MTGJSON: 'https://mtgjson.com',
  GITHUB: 'https://github.com',
} as const
