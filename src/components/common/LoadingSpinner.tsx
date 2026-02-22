/**
 * LoadingSpinner Component
 *
 * Animated loading indicator for async operations.
 * Can be shown as inline or full-page overlay.
 */

import React from 'react'

interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Text to display below spinner */
  text?: string
  /** Whether to show as full-page overlay */
  fullPage?: boolean
  /** Custom className */
  className?: string
}

/**
 * Loading spinner component
 *
 * @example
 * <LoadingSpinner size="lg" text="Loading products..." />
 * <LoadingSpinner fullPage text="Please wait..." />
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  text,
  fullPage = false,
  className = '',
}) => {
  // Size classes for the spinner
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24',
  }

  const spinnerElement = (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <svg
        className={`animate-spin text-primary-600 ${sizeClasses[size]}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {text && (
        <p className="mt-4 text-[var(--text-2)] font-medium">{text}</p>
      )}
    </div>
  )

  if (fullPage) {
    return (
      <div className="fixed inset-0 bg-[#0b0d14]/90 backdrop-blur-sm flex items-center justify-center z-50">
        {spinnerElement}
      </div>
    )
  }

  return spinnerElement
}
