/**
 * Card Component
 *
 * Container component for content sections.
 * Provides consistent styling and optional header/footer areas.
 */

import React from 'react'

interface CardProps {
  /** Card title */
  title?: string
  /** Card header content (takes precedence over title) */
  header?: React.ReactNode
  /** Card footer content */
  footer?: React.ReactNode
  /** Main card content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Padding size */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Whether to show hover effect */
  hoverable?: boolean
}

/**
 * Card container component
 *
 * @example
 * <Card title="Product Details">
 *   <p>Card content goes here</p>
 * </Card>
 */
export const Card: React.FC<CardProps> = ({
  title,
  header,
  footer,
  children,
  className = '',
  padding = 'md',
  hoverable = false,
}) => {
  const paddingClasses = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-4 sm:p-6',
    lg: 'p-6 sm:p-8',
  }

  const hoverClass = hoverable
    ? 'hover:shadow-lg hover:border-white/20 transition-all duration-200'
    : ''

  return (
    <div
      className={`bg-[var(--bg-surface)] backdrop-blur-xl rounded-xl border border-[var(--border-color)] shadow-md ${hoverClass} ${className}`}
    >
      {/* Header */}
      {(header || title) && (
        <div className="px-4 sm:px-6 py-4 border-b border-[var(--border-color-2)]">
          {header || <h3 className="text-base sm:text-lg font-semibold text-[var(--text-1)]">{title}</h3>}
        </div>
      )}

      {/* Content */}
      <div className={paddingClasses[padding]}>{children}</div>

      {/* Footer */}
      {footer && (
        <div className="px-4 sm:px-6 py-4 border-t border-[var(--border-color-2)] bg-white/[0.02]">
          {footer}
        </div>
      )}
    </div>
  )
}
