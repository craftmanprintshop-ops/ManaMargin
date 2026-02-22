/**
 * usePagination Hook
 *
 * Manages pagination state and calculations.
 * Provides functions for navigating between pages.
 *
 * Usage example:
 * ```typescript
 * const {
 *   currentPage,
 *   pageSize,
 *   totalPages,
 *   goToPage,
 *   nextPage,
 *   previousPage,
 *   setPageSize,
 * } = usePagination({ totalItems: 100, initialPageSize: 25 })
 * ```
 */

import { useState, useMemo, useCallback } from 'react'
import type { PaginationState } from '../types/models'

interface UsePaginationOptions {
  /** Total number of items to paginate */
  totalItems: number
  /** Initial page size (items per page) */
  initialPageSize?: number
  /** Initial page number (1-indexed) */
  initialPage?: number
}

interface UsePaginationReturn extends PaginationState {
  /** Navigate to a specific page (1-indexed) */
  goToPage: (page: number) => void
  /** Go to the next page */
  nextPage: () => void
  /** Go to the previous page */
  previousPage: () => void
  /** Change the page size */
  setPageSize: (size: number) => void
  /** Whether there is a next page */
  hasNextPage: boolean
  /** Whether there is a previous page */
  hasPreviousPage: boolean
  /** Start index for current page (0-indexed) */
  startIndex: number
  /** End index for current page (0-indexed, exclusive) */
  endIndex: number
}

/**
 * Hook for managing pagination
 *
 * @param options - Pagination configuration
 * @returns Pagination state and navigation functions
 */
export function usePagination(options: UsePaginationOptions): UsePaginationReturn {
  const {
    totalItems,
    initialPageSize = 25,
    initialPage = 1,
  } = options

  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageSize, setPageSizeState] = useState(initialPageSize)

  // Calculate total pages
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalItems / pageSize))
  }, [totalItems, pageSize])

  // Ensure current page is within valid range
  const validatedPage = useMemo(() => {
    return Math.max(1, Math.min(currentPage, totalPages))
  }, [currentPage, totalPages])

  // Calculate start and end indices for current page
  const startIndex = useMemo(() => {
    return (validatedPage - 1) * pageSize
  }, [validatedPage, pageSize])

  const endIndex = useMemo(() => {
    return Math.min(startIndex + pageSize, totalItems)
  }, [startIndex, pageSize, totalItems])

  // Navigation functions
  const goToPage = useCallback(
    (page: number) => {
      const newPage = Math.max(1, Math.min(page, totalPages))
      setCurrentPage(newPage)
    },
    [totalPages]
  )

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1)
  }, [currentPage, goToPage])

  const previousPage = useCallback(() => {
    goToPage(currentPage - 1)
  }, [currentPage, goToPage])

  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size)
      // Reset to first page when page size changes
      setCurrentPage(1)
    },
    []
  )

  return {
    currentPage: validatedPage,
    pageSize,
    totalItems,
    totalPages,
    goToPage,
    nextPage,
    previousPage,
    setPageSize,
    hasNextPage: validatedPage < totalPages,
    hasPreviousPage: validatedPage > 1,
    startIndex,
    endIndex,
  }
}
