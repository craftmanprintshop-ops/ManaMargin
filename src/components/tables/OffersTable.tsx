/**
 * OffersTable Component
 *
 * Displays offers/products in a sortable table.
 * Shows product name, price, shipping, marketplace, and stock status.
 */

import React, { useState, useMemo } from 'react'
import type { OffersLatestEnriched } from '../../types/models'
import { Badge } from '../common/Badge'
import { formatCurrency, formatDate } from '../../utils/formatters'

interface OffersTableProps {
  /** Array of offers to display */
  data: OffersLatestEnriched[]
  /** Whether data is loading */
  loading: boolean
}

type SortField = 'price' | 'marketplace' | 'title' | 'fetched_at'
type SortOrder = 'asc' | 'desc'

/**
 * Sortable table displaying product offers
 *
 * Data comes from the offers_latest_enriched view
 */
export const OffersTable: React.FC<OffersTableProps> = ({ data, loading }) => {
  const [sortField, setSortField] = useState<SortField>('price')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // Sort data based on current sort settings
  const sortedData = useMemo(() => {
    if (!data || data.length === 0) return []

    return [...data].sort((a, b) => {
      let aVal: string | number | null | undefined
      let bVal: string | number | null | undefined

      switch (sortField) {
        case 'price':
          aVal = a.price
          bVal = b.price
          break
        case 'marketplace':
          aVal = a.marketplace
          bVal = b.marketplace
          break
        case 'title':
          aVal = a.title
          bVal = b.title
          break
        case 'fetched_at':
          aVal = a.fetched_at
          bVal = b.fetched_at
          break
        default:
          aVal = a.price
          bVal = b.price
      }

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [data, sortField, sortOrder])

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle order if clicking same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new field and default to ascending
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Render sort indicator
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return (
      <span className="ml-1">
        {sortOrder === 'asc' ? '↑' : '↓'}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-gray-600">Loading products...</p>
      </div>
    )
  }

  if (sortedData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <p className="text-gray-600">No products found matching your filters.</p>
        <p className="text-sm text-gray-500 mt-2">Try adjusting your filters or search terms.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th
                onClick={() => handleSort('title')}
                className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200 transition-colors"
              >
                Product <SortIndicator field="title" />
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Set
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Type
              </th>
              <th
                onClick={() => handleSort('price')}
                className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200 transition-colors"
              >
                Price <SortIndicator field="price" />
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Shipping
              </th>
              <th
                onClick={() => handleSort('marketplace')}
                className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200 transition-colors"
              >
                Marketplace <SortIndicator field="marketplace" />
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Stock
              </th>
              <th
                onClick={() => handleSort('fetched_at')}
                className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200 transition-colors"
              >
                Updated <SortIndicator field="fetched_at" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedData.map((offer) => (
              <tr
                key={`${offer.canonical_sku}-${offer.marketplace}-${offer.id}`}
                className="hover:bg-gray-50 transition-colors"
              >
                {/* Product Name */}
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {offer.display_name || offer.title || 'Unknown Product'}
                  </div>
                  {offer.image_url && (
                    <img
                      src={offer.image_url}
                      alt={offer.title || ''}
                      className="mt-1 h-12 w-auto object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                </td>

                {/* Set Name */}
                <td className="px-4 py-3 text-sm text-gray-600">
                  {offer.set_name || '-'}
                </td>

                {/* Product Type */}
                <td className="px-4 py-3 text-sm text-gray-600">
                  {offer.product_type || '-'}
                </td>

                {/* Price */}
                <td className="px-4 py-3">
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(offer.price)}
                  </span>
                </td>

                {/* Shipping */}
                <td className="px-4 py-3 text-sm text-gray-600">
                  {formatCurrency(offer.shipping)}
                </td>

                {/* Marketplace */}
                <td className="px-4 py-3 text-sm text-gray-600">
                  {offer.url ? (
                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:text-primary-700 hover:underline"
                    >
                      {offer.marketplace}
                    </a>
                  ) : (
                    offer.marketplace
                  )}
                </td>

                {/* Stock Status */}
                <td className="px-4 py-3">
                  <Badge variant={offer.in_stock ? 'success' : 'danger'}>
                    {offer.in_stock ? 'In Stock' : 'Out of Stock'}
                  </Badge>
                </td>

                {/* Last Updated */}
                <td className="px-4 py-3 text-sm text-gray-500">
                  {formatDate(offer.fetched_at, 'relative')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Results count */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
        Showing {sortedData.length} product{sortedData.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
