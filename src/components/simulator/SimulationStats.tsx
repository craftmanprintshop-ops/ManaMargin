/**
 * SimulationStats Component
 *
 * Displays statistics from multiple pack openings.
 * Shows average value, median, highest, lowest, and distribution.
 */

import React from 'react'
import type { SimulationResults } from '../../types/models'
import { formatCurrency } from '../../utils/formatters'
import { Card } from '../common/Card'

interface SimulationStatsProps {
  /** Simulation results with statistics */
  results: SimulationResults
}

/**
 * Statistics display for pack simulation
 */
export const SimulationStats: React.FC<SimulationStatsProps> = ({ results }) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* Average Value */}
      <Card padding="md">
        <div className="text-center">
          <p className="text-xs sm:text-sm text-[var(--text-2)] mb-1">Average Pack Value</p>
          <p className="text-2xl sm:text-3xl font-bold text-primary-600">
            {formatCurrency(results.averageValue)}
          </p>
          <p className="text-[10px] sm:text-xs text-[var(--text-2)]/70 mt-1">
            Expected value per pack
          </p>
        </div>
      </Card>

      {/* Median Value */}
      <Card padding="md">
        <div className="text-center">
          <p className="text-xs sm:text-sm text-[var(--text-2)] mb-1">Median Value</p>
          <p className="text-2xl sm:text-3xl font-bold text-[var(--text-1)]">
            {formatCurrency(results.medianValue)}
          </p>
          <p className="text-[10px] sm:text-xs text-[var(--text-2)]/70 mt-1">
            Middle pack value
          </p>
        </div>
      </Card>

      {/* Highest Value */}
      <Card padding="md">
        <div className="text-center">
          <p className="text-xs sm:text-sm text-[var(--text-2)] mb-1">Best Pack</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-400">
            {formatCurrency(results.highestValue)}
          </p>
          <p className="text-[10px] sm:text-xs text-[var(--text-2)]/70 mt-1">
            Luckiest pull
          </p>
        </div>
      </Card>

      {/* Lowest Value */}
      <Card padding="md">
        <div className="text-center">
          <p className="text-xs sm:text-sm text-[var(--text-2)] mb-1">Worst Pack</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-400">
            {formatCurrency(results.lowestValue)}
          </p>
          <p className="text-[10px] sm:text-xs text-[var(--text-2)]/70 mt-1">
            Unluckiest pull
          </p>
        </div>
      </Card>
    </div>
  )
}
