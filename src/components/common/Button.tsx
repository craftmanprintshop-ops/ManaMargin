/**
 * Button Component
 *
 * Reusable button component with different variants and sizes.
 * Uses Tailwind CSS classes for consistent styling.
 */

import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  /** Button size */
  size?: 'sm' | 'md' | 'lg'
  /** Whether the button is in a loading state */
  loading?: boolean
  /** Full width button */
  fullWidth?: boolean
}

/**
 * Button component with multiple variants and sizes
 *
 * @example
 * <Button variant="primary" onClick={() => alert('Clicked')}>
 *   Click Me
 * </Button>
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  ...props
}) => {
  // Variant styles
  const variantClasses = {
    primary: 'bg-[var(--brand)] hover:bg-[var(--primary-700)] text-white',
    secondary: 'bg-[var(--bg-hover-2)] hover:bg-white/15 text-[var(--text-1)] border border-[var(--border-color)]',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    ghost: 'bg-transparent hover:bg-[var(--bg-hover-2)] text-[var(--text-2)] border border-[var(--border-color)]',
  }

  // Size styles
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }

  // Combine all classes
  const buttonClasses = `
    ${variantClasses[variant]}
    ${sizeClasses[size]}
    ${fullWidth ? 'w-full' : ''}
    font-medium
    rounded-lg
    transition-colors
    duration-200
    disabled:opacity-50
    disabled:cursor-not-allowed
    focus:outline-none
    focus:ring-2
    focus:ring-primary-500
    focus:ring-offset-2
    ${className}
  `.trim().replace(/\s+/g, ' ')

  return (
    <button
      className={buttonClasses}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center">
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
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
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  )
}
