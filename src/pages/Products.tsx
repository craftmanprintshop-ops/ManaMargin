/**
 * Products Page
 *
 * Main page for browsing products and comparing prices.
 * Fetches data from Supabase and displays with filters and table.
 */

import React, { useEffect } from 'react'
import { useSupabaseQuery } from '../hooks/useSupabaseQuery'
import { useFilterState } from '../hooks/useFilterState'
import { offersService } from '../services/offersService'
import { OffersFilter } from '../components/filters/OffersFilter'
import { OffersTable } from '../components/tables/OffersTable'
import { ErrorMessage } from '../components/common/ErrorMessage'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

/**
 * Products page - browse and compare sealed product prices
 *
 * This page:
 * 1. Fetches latest offers from Supabase (offers_latest_enriched view)
 * 2. Fetches filter options from dropdown views
 * 3. Allows filtering by set, product type, foil, marketplace
 * 4. Displays results in sortable table
 */
export const Products: React.FC = () => {
  const { filters, updateFilter, resetFilters } = useFilterState()

  // Fetch filter options (sets, product types, foil variants)
  const {
    data: filterOptions,
    loading: optionsLoading,
    error: optionsError,
  } = useSupabaseQuery(
    () => offersService.getFilterOptions(),
    [] // Only fetch once on mount
  )

  // Fetch offers with current filters
  const {
    data: offers,
    loading: offersLoading,
    error: offersError,
    refetch: refetchOffers,
  } = useSupabaseQuery(
    () => offersService.getLatestOffers(filters),
    [filters] // Re-fetch when filters change
  )

  // Log data for debugging (remove in production)
  useEffect(() => {
    if (offers) {
      console.log(`Loaded ${offers.length} offers`)
    }
  }, [offers])

  // Handle filter options error
  if (optionsError) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Products</h1>
        <ErrorMessage
          title="Failed to load filter options"
          message={optionsError.message || 'Could not connect to database'}
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  // Handle offers error
  if (offersError) {
    return (
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Products</h1>
        {filterOptions && (
          <OffersFilter
            filters={filters as any}
            options={filterOptions}
            onFilterChange={updateFilter as any}
            onReset={resetFilters}
            loading={false}
          />
        )}
        <ErrorMessage
          title="Failed to load products"
          message={offersError.message || 'Could not fetch product data'}
          onRetry={refetchOffers}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Price Comparison</h1>
        <p className="mt-2 text-gray-600">
          Compare sealed product prices across multiple retailers
        </p>
      </div>

      {/* Loading state for initial filter options */}
      {optionsLoading && !filterOptions && (
        <LoadingSpinner size="lg" text="Loading filter options..." />
      )}

      {/* Filter Panel */}
      {filterOptions && (
        <OffersFilter
          filters={filters as any}
          options={filterOptions}
          onFilterChange={updateFilter as any}
          onReset={resetFilters}
          loading={offersLoading}
        />
      )}

      {/* Offers Table */}
      <OffersTable
        data={offers || []}
        loading={offersLoading}
      />

      {/* Database Info (development only) */}
      {import.meta.env.DEV && offers && (
        <div className="bg-gray-100 rounded-lg p-4 text-xs text-gray-600">
          <p className="font-semibold mb-1">Debug Info:</p>
          <p>Total offers loaded: {offers.length}</p>
          <p>Active filters: {Object.values(filters).filter(v => v !== '' && v !== undefined && v !== false).length}</p>
        </div>
      )}
    </div>
  )
}
