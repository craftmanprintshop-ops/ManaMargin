/**
 * useSupabaseQuery Hook
 *
 * Generic hook for fetching data from Supabase with loading and error states.
 * Provides automatic refetching and dependency tracking.
 *
 * Usage example:
 * ```typescript
 * const { data, loading, error, refetch } = useSupabaseQuery(
 *   () => offersService.getLatestOffers(filters),
 *   [filters] // Re-fetch when filters change
 * )
 * ```
 */

import { useState, useEffect, useCallback, DependencyList } from 'react'
import { PostgrestError } from '@supabase/supabase-js'

interface UseQueryOptions {
  /**
   * Whether to fetch data immediately on mount
   * @default true
   */
  immediate?: boolean
}

interface UseQueryState<T> {
  /** The fetched data, null if not yet loaded or error occurred */
  data: T | null
  /** True while the query is in progress */
  loading: boolean
  /** Error object if the query failed, null otherwise */
  error: PostgrestError | Error | null
}

interface UseQueryReturn<T> extends UseQueryState<T> {
  /** Function to manually trigger a re-fetch */
  refetch: () => Promise<void>
}

/**
 * Hook for querying Supabase with automatic loading and error states
 *
 * @param queryFn - Async function that returns data from Supabase
 * @param dependencies - Array of dependencies that trigger a re-fetch when changed
 * @param options - Configuration options
 * @returns Object with data, loading, error states and refetch function
 */
export function useSupabaseQuery<T>(
  queryFn: () => Promise<T>,
  dependencies: DependencyList = [],
  options: UseQueryOptions = { immediate: true }
): UseQueryReturn<T> {
  const [state, setState] = useState<UseQueryState<T>>({
    data: null,
    loading: options.immediate !== false,
    error: null,
  })

  // Memoize the fetch function to prevent unnecessary re-renders
  const fetchData = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }))
      const result = await queryFn()
      setState({ data: result, loading: false, error: null })
    } catch (error) {
      console.error('Query error:', error)
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      })
    }
  }, [queryFn])

  // Fetch data when dependencies change
  useEffect(() => {
    if (options.immediate !== false) {
      fetchData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return {
    ...state,
    refetch: fetchData,
  }
}
