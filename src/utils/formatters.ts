/**
 * Formatting Utilities
 *
 * Functions for formatting data for display in the UI.
 * Includes currency, date, and number formatting.
 */

/**
 * Format a number as USD currency
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(12.5) // "$12.50"
 * formatCurrency(1234.56) // "$1,234.56"
 */
export function formatCurrency(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) {
    return '-'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * Format a date string to readable format
 *
 * @param dateString - ISO date string or Date object
 * @param format - Format style ('short', 'medium', 'long', or 'relative')
 * @returns Formatted date string
 *
 * @example
 * formatDate('2024-03-15') // "Mar 15, 2024"
 * formatDate('2024-03-15', 'long') // "March 15, 2024"
 */
export function formatDate(
  dateString: string | Date | null | undefined,
  format: 'short' | 'medium' | 'long' | 'relative' = 'medium'
): string {
  if (!dateString) {
    return '-'
  }

  const date = typeof dateString === 'string' ? new Date(dateString) : dateString

  if (isNaN(date.getTime())) {
    return '-'
  }

  if (format === 'relative') {
    return formatRelativeDate(date)
  }

  const optionsMap: Record<string, Intl.DateTimeFormatOptions> = {
    short: { month: 'short', day: 'numeric', year: 'numeric' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { month: 'long', day: 'numeric', year: 'numeric' },
  }
  const options = optionsMap[format]

  return new Intl.DateTimeFormat('en-US', options).format(date)
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 *
 * @param date - Date to format
 * @returns Relative time string
 */
function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) {
    return 'just now'
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  } else {
    return formatDate(date, 'short')
  }
}

/**
 * Format a number with thousands separators
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1234.5678, 2) // "1,234.57"
 */
export function formatNumber(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined) {
    return '-'
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * Format a percentage value
 *
 * @param value - Number between 0 and 1 (or 0 and 100 if asPercent is true)
 * @param decimals - Number of decimal places
 * @param asPercent - Whether the value is already in percentage form
 * @returns Formatted percentage string
 *
 * @example
 * formatPercentage(0.1542) // "15.42%"
 * formatPercentage(15.42, 2, true) // "15.42%"
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 2,
  asPercent: boolean = false
): string {
  if (value === null || value === undefined) {
    return '-'
  }

  const percentValue = asPercent ? value : value * 100

  return `${percentValue.toFixed(decimals)}%`
}

/**
 * Truncate a string to a maximum length with ellipsis
 *
 * @param text - String to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string
 *
 * @example
 * truncate('This is a very long product name', 20) // "This is a very lon..."
 */
export function truncate(text: string | null | undefined, maxLength: number): string {
  if (!text) {
    return ''
  }

  if (text.length <= maxLength) {
    return text
  }

  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Format a product type for display
 *
 * @param productType - Product type code
 * @returns Formatted product type
 *
 * @example
 * formatProductType('booster_box') // "Booster Box"
 * formatProductType('collector_booster') // "Collector Booster"
 */
export function formatProductType(productType: string | null | undefined): string {
  if (!productType) {
    return '-'
  }

  return productType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Format card rarity for display
 *
 * @param rarity - Rarity code
 * @returns Formatted rarity with color class
 */
export function formatRarity(rarity: string | null | undefined): {
  text: string
  colorClass: string
} {
  if (!rarity) {
    return { text: '-', colorClass: '' }
  }

  const rarityLower = rarity.toLowerCase()

  const colorMap: Record<string, string> = {
    common: 'text-gray-600',
    uncommon: 'text-gray-400',
    rare: 'text-yellow-600',
    mythic: 'text-orange-600',
    special: 'text-purple-600',
  }

  return {
    text: rarity.charAt(0).toUpperCase() + rarity.slice(1),
    colorClass: colorMap[rarityLower] || 'text-gray-600',
  }
}

/**
 * Format mana cost symbols
 *
 * @param manaCost - Mana cost string (e.g., "{3}{U}{U}")
 * @returns Array of mana symbols
 *
 * @example
 * formatManaCost("{3}{U}{U}") // ["3", "U", "U"]
 */
export function formatManaCost(manaCost: string | null | undefined): string[] {
  if (!manaCost) {
    return []
  }

  const symbols = manaCost.match(/{([^}]+)}/g) || []
  return symbols.map((symbol) => symbol.replace(/{|}/g, ''))
}
