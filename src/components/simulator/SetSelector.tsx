/**
 * SetSelector Component
 *
 * Dropdown for selecting which MTG set to simulate.
 * Also allows choosing number of packs to open.
 */

import React from 'react'
import { PACK_SIMULATION_OPTIONS } from '../../utils/constants'
import { Button } from '../common/Button'

interface SetSelectorProps {
  /** Currently selected set code */
  selectedSet: string
  /** Callback when set changes */
  onSetChange: (setCode: string) => void
  /** Currently selected pack count */
  packCount: number
  /** Callback when pack count changes */
  onPackCountChange: (count: number) => void
  /** Callback to start simulation */
  onSimulate: () => void
  /** Whether simulation is in progress */
  isSimulating: boolean
  /** Available sets */
  availableSets?: string[]
}

/**
 * Set and pack count selector for pack simulator
 */
export const SetSelector: React.FC<SetSelectorProps> = ({
  selectedSet,
  onSetChange,
  packCount,
  onPackCountChange,
  onSimulate,
  isSimulating,
  availableSets = ['MH3', 'BRO', 'ONE', 'MOM', 'WOE', 'LCI', 'MKM', 'OTJ', 'BLB'],
}) => {
  return (
    <div className="bg-[#0f111a]/80 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl p-4 sm:p-6">
      <h2 className="text-xl font-semibold text-[var(--text-1)] mb-4">
        Pack Simulator
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {/* Set Selection */}
        <div>
          <label
            htmlFor="set"
            className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-wider mb-2"
          >
            Select Set
          </label>
          <select
            id="set"
            value={selectedSet}
            onChange={(e) => onSetChange(e.target.value)}
            disabled={isSimulating}
            className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
          >
            <option value="">Choose a set...</option>
            {availableSets.map((set) => (
              <option key={set} value={set}>
                {set}
              </option>
            ))}
          </select>
        </div>

        {/* Pack Count Selection */}
        <div>
          <label
            htmlFor="packCount"
            className="block text-xs font-bold text-[var(--text-2)] uppercase tracking-wider mb-2"
          >
            Number of Packs
          </label>
          <select
            id="packCount"
            value={packCount}
            onChange={(e) => onPackCountChange(Number(e.target.value))}
            disabled={isSimulating}
            className="w-full bg-[var(--bg-2)] border border-white/20 rounded-lg p-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--brand)] disabled:opacity-50"
          >
            {PACK_SIMULATION_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count} packs
              </option>
            ))}
          </select>
        </div>

        {/* Simulate Button */}
        <div className="flex items-end">
          <Button
            onClick={onSimulate}
            disabled={!selectedSet || isSimulating}
            loading={isSimulating}
            variant="primary"
            fullWidth
            size="lg"
          >
            {isSimulating ? 'Opening Packs...' : 'Open Packs'}
          </Button>
        </div>
      </div>

      {/* Info Text */}
      <p className="mt-4 text-sm text-[var(--text-2)]">
        Simulate opening booster packs and calculate the expected value based on current card prices.
      </p>
    </div>
  )
}
