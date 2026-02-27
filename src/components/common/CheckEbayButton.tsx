import React, { useState } from 'react'
import { EbayPriceModal } from './EbayPriceModal'

interface CheckEbayButtonProps {
  query: string
  productLabel?: string
  className?: string
}

export const CheckEbayButton: React.FC<CheckEbayButtonProps> = ({ query, productLabel, className = '' }) => {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setModalOpen(true) }}
        className={`min-h-8 min-w-8 p-1.5 hover:bg-[var(--bg-hover-2)] rounded-lg text-[var(--text-2)] hover:text-[var(--brand)] transition-all shrink-0 flex items-center justify-center ${className}`}
        title="Check eBay Prices"
        aria-label="Check eBay prices"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </button>
      {modalOpen && (
        <EbayPriceModal
          query={query}
          productLabel={productLabel || query}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
