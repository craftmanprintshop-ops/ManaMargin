/**
 * ErrorMessage Component
 *
 * Displays error messages with optional retry functionality.
 * Used throughout the app for consistent error handling UI.
 */

import React from 'react'
import { Button } from './Button'

interface ErrorMessageProps {
  /** Error title */
  title?: string
  /** Error message or description */
  message: string
  /** Optional retry callback */
  onRetry?: () => void
  /** Custom className */
  className?: string
  /** Whether to show in a card/box */
  boxed?: boolean
}

/**
 * Error message display component
 *
 * @example
 * <ErrorMessage
 *   title="Failed to load products"
 *   message="Could not connect to the database. Please try again."
 *   onRetry={() => refetch()}
 * />
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title = 'An error occurred',
  message,
  onRetry,
  className = '',
  boxed = true,
}) => {
  const content = (
    <div className="flex flex-col items-center justify-center text-center">
      {/* Error Icon */}
      <svg
        className="h-12 w-12 text-red-500 mb-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>

      {/* Error Text */}
      <h3 className="text-lg font-semibold text-[var(--text-1)] mb-2">{title}</h3>
      <p className="text-[var(--text-2)] mb-4 max-w-md">{message}</p>

      {/* Retry Button */}
      {onRetry && (
        <Button onClick={onRetry} variant="primary">
          Try Again
        </Button>
      )}
    </div>
  )

  if (boxed) {
    return (
      <div
        className={`bg-red-500/10 border border-red-500/20 rounded-lg p-8 ${className}`}
      >
        {content}
      </div>
    )
  }

  return <div className={className}>{content}</div>
}
