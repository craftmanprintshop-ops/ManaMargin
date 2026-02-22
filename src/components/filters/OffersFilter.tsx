/**
 * OffersFilter Component
 *
 * Filter UI for the products/offers table.
 * Allows filtering by set, product type, foil variant, marketplace, and search.
 */

import React from 'react'
import type { FilterState, FilterOptions } from '../../types/models'
import { Button } from '../common/Button'

interface OffersFilterProps {
  /** Current filter state */
  filters: FilterState
  /** Available filter options from database */
  options: FilterOptions
  /** Callback when a filter changes */
  onFilterChange: (key: keyof FilterState, value: unknown) => void
  /** Callback to reset all filters */
  onReset: () => void
  /** Whether filters are loading */
  loading?: boolean
}

/**
 * Filter panel for offers/products table
 *
 * Connects to Supabase views for filter options:
 * - offers_dropdown_sets
 * - offers_dropdown_product_types
 * - offers_dropdown_foil
 */
export const OffersFilter: React.FC<OffersFilterProps> = ({
  filters,
  options,
  onFilterChange,
  onReset,
  loading = false,
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* Search Input */}
        <div className="lg:col-span-2">
          <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
            Search Products
          </label>
          <input
            id="search"
            type="text"
            placeholder="Search by product name..."
            value={filters.searchTerm}
            onChange={(e) => onFilterChange('searchTerm', e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
          />
        </div>

        {/* Set Filter */}
        <div>
          <label htmlFor="set" className="block text-sm font-medium text-gray-700 mb-1">
            Set
          </label>
          <select
            id="set"
            value={filters.selectedSet || ''}
            onChange={(e) => onFilterChange('selectedSet', e.target.value || undefined)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
          >
            <option value="">All Sets</option>
            {options.sets.map((set) => (
              <option key={set.set_name || 'unknown'} value={set.set_name || ''}>
                {set.set_name || 'Unknown'}
              </option>
            ))}
          </select>
        </div>

        {/* Product Type Filter */}
        <div>
          <label htmlFor="productType" className="block text-sm font-medium text-gray-700 mb-1">
            Product Type
          </label>
          <select
            id="productType"
            value={filters.productType || ''}
            onChange={(e) => onFilterChange('productType', e.target.value || undefined)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
          >
            <option value="">All Types</option>
            {options.productTypes.map((pt) => (
              <option key={pt.product_type || 'unknown'} value={pt.product_type || ''}>
                {pt.product_type || 'Unknown'}
              </option>
            ))}
          </select>
        </div>

        {/* Foil Variant Filter */}
        <div>
          <label htmlFor="foil" className="block text-sm font-medium text-gray-700 mb-1">
            Foil
          </label>
          <select
            id="foil"
            value={filters.foilVariant || ''}
            onChange={(e) => onFilterChange('foilVariant', e.target.value || undefined)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
          >
            <option value="">All Variants</option>
            {options.foilVariants.map((foil) => (
              <option key={foil.foil || 'nonfoil'} value={foil.foil || ''}>
                {foil.foil || 'Non-Foil'}
              </option>
            ))}
          </select>
        </div>

        {/* Reset Button */}
        <div className="flex items-end">
          <Button
            onClick={onReset}
            variant="secondary"
            disabled={loading}
            fullWidth
          >
            Reset Filters
          </Button>
        </div>
      </div>

      {/* In Stock Only Checkbox */}
      <div className="mt-4 flex items-center">
        <input
          id="inStockOnly"
          type="checkbox"
          checked={filters.inStockOnly || false}
          onChange={(e) => onFilterChange('inStockOnly', e.target.checked)}
          disabled={loading}
          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
        />
        <label htmlFor="inStockOnly" className="ml-2 text-sm text-gray-700">
          Show in-stock items only
        </label>
      </div>
    </div>
  )
}
