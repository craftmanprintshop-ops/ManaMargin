/**
 * Badge Component
 *
 * Small status indicator component.
 * Commonly used for stock status, rarities, etc.
 */

import React from 'react'

interface BadgeProps {
  /** Badge text content */
  children: React.ReactNode
  /** Badge color variant */
  variant?: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  /** Badge size */
  size?: 'sm' | 'md' | 'lg'
  /** Custom className */
  className?: string
}

/**
 * Badge component for status indicators
 *
 * @example
 * <Badge variant="success">In Stock</Badge>
 * <Badge variant="danger">Out of Stock</Badge>
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
}) => {
  // Variant colors
  const variantClasses = {
    success: 'bg-green-500/15 text-green-400 border border-green-500/20',
    danger: 'bg-red-500/15 text-red-400 border border-red-500/20',
    warning: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
    info: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    neutral: 'bg-white/10 text-[var(--text-2)] border border-white/10',
  }

  // Size classes
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }

  const badgeClasses = `
    inline-block
    ${variantClasses[variant]}
    ${sizeClasses[size]}
    font-semibold
    rounded-full
    ${className}
  `.trim().replace(/\s+/g, ' ')

  return <span className={badgeClasses}>{children}</span>
}
