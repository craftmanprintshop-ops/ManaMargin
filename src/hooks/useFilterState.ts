/**
 * useFilterState Hook
 *
 * Manages filter state for products/offers tables.
 * Provides functions to update individual filters and reset all filters.
 *
 * Usage example:
 * ```typescript
 * const { filters, updateFilter, resetFilters, setFilters } = useFilterState()
 *
 * // Update a single filter
 * updateFilter('selectedSet', 'Modern Horizons 3')
 *
 * // Reset all filters
 * resetFilters()
 *
 * // Set multiple filters at once
 * setFilters({ selectedSet: 'MH3', productType: 'booster_box' })
 * ```
 */

import { useState, useCallback } from 'react'
import type { FilterState } from '../types/models'

const initialFilters: FilterState = {
  searchTerm: '',
  selectedSet: undefined,
  productType: undefined,
  foilVariant: undefined,
  marketplace: undefined,
  priceRange: undefined,
  inStockOnly: false,
}

interface UseFilterStateReturn {
  /** Current filter state */
  filters: FilterState
  /** Update a single filter value */
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  /** Reset all filters to initial state */
  resetFilters: () => void
  /** Set multiple filters at once */
  setFilters: (newFilters: Partial<FilterState>) => void
}

/**
 * Hook for managing filter state
 *
 * @param initialState - Optional custom initial filter state
 * @returns Filter state and update functions
 */
export function useFilterState(
  initialState: Partial<FilterState> = {}
): UseFilterStateReturn {
  const [filters, setFiltersState] = useState<FilterState>({
    ...initialFilters,
    ...initialState,
  })

  /**
   * Update a single filter value
   */
  const updateFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFiltersState((prev) => ({
        ...prev,
        [key]: value,
      }))
    },
    []
  )

  /**
   * Reset all filters to initial state
   */
  const resetFilters = useCallback(() => {
    setFiltersState({
      ...initialFilters,
      ...initialState,
    })
  }, [initialState])

  /**
   * Set multiple filters at once
   */
  const setFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
    }))
  }, [])

  return {
    filters,
    updateFilter,
    resetFilters,
    setFilters,
  }
}
