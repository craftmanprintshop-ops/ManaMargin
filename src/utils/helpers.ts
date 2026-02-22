/**
 * Helper Utilities
 *
 * General-purpose utility functions used throughout the application.
 */

/**
 * Debounce a function call
 *
 * @param func - Function to debounce
 * @param wait - Milliseconds to wait
 * @returns Debounced function
 *
 * @example
 * const debouncedSearch = debounce((query) => search(query), 300)
 */
export function debounce<T extends (...args: never[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null
      func(...args)
    }

    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(later, wait)
  }
}

/**
 * Throttle a function call
 *
 * @param func - Function to throttle
 * @param limit - Minimum milliseconds between calls
 * @returns Throttled function
 */
export function throttle<T extends (...args: never[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Generate a random ID
 *
 * @param prefix - Optional prefix for the ID
 * @returns Random ID string
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Deep clone an object
 *
 * @param obj - Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Check if a value is empty (null, undefined, empty string, empty array)
 *
 * @param value - Value to check
 * @returns True if empty
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }

  if (typeof value === 'string') {
    return value.trim().length === 0
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0
  }

  return false
}

/**
 * Group an array of objects by a key
 *
 * @param array - Array to group
 * @param key - Key to group by
 * @returns Object with grouped items
 *
 * @example
 * groupBy([{type: 'rare', name: 'A'}, {type: 'common', name: 'B'}], 'type')
 * // { rare: [{type: 'rare', name: 'A'}], common: [{type: 'common', name: 'B'}] }
 */
export function groupBy<T extends Record<string, unknown>>(
  array: T[],
  key: keyof T
): Record<string, T[]> {
  return array.reduce((result, item) => {
    const groupKey = String(item[key])
    if (!result[groupKey]) {
      result[groupKey] = []
    }
    result[groupKey].push(item)
    return result
  }, {} as Record<string, T[]>)
}

/**
 * Sort an array of objects by a key
 *
 * @param array - Array to sort
 * @param key - Key to sort by
 * @param order - Sort order ('asc' or 'desc')
 * @returns Sorted array
 */
export function sortBy<T extends Record<string, unknown>>(
  array: T[],
  key: keyof T,
  order: 'asc' | 'desc' = 'asc'
): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key]
    const bVal = b[key]

    if (aVal === bVal) return 0

    const comparison = aVal < bVal ? -1 : 1
    return order === 'asc' ? comparison : -comparison
  })
}

/**
 * Calculate the median of an array of numbers
 *
 * @param numbers - Array of numbers
 * @returns Median value
 */
export function median(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0
  }

  const sorted = [...numbers].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }

  return sorted[middle]
}

/**
 * Calculate the average of an array of numbers
 *
 * @param numbers - Array of numbers
 * @returns Average value
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0
  }

  return numbers.reduce((sum, num) => sum + num, 0) / numbers.length
}

/**
 * Clamp a number between min and max values
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Sleep for a specified duration (for async operations)
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse a canonical SKU to extract product information
 *
 * @param sku - Canonical SKU string
 * @returns Parsed SKU information
 */
export function parseSku(sku: string): {
  set: string | null
  productType: string | null
} {
  // Example SKU format: "mh3-draft-booster-box"
  const parts = sku.split('-')

  if (parts.length < 2) {
    return { set: null, productType: null }
  }

  return {
    set: parts[0],
    productType: parts.slice(1).join('-'),
  }
}

/**
 * Build a URL with query parameters
 *
 * @param baseUrl - Base URL
 * @param params - Query parameters
 * @returns Full URL with query string
 *
 * @example
 * buildUrl('/api/products', { set: 'MH3', type: 'box' })
 * // "/api/products?set=MH3&type=box"
 */
export function buildUrl(
  baseUrl: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  if (!params || Object.keys(params).length === 0) {
    return baseUrl
  }

  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value))
    }
  })

  const queryString = searchParams.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

/**
 * Copy text to clipboard
 *
 * @param text - Text to copy
 * @returns Promise that resolves when copy succeeds
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
  } else {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}
