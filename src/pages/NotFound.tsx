/**
 * NotFound Page
 *
 * 404 error page for invalid routes.
 */

import React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/common/Button'

export const NotFound: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-6xl font-bold text-[var(--text-1)] mb-4">404</h1>
      <h2 className="text-2xl font-semibold text-[var(--text-2)] mb-4">Page Not Found</h2>
      <p className="text-[var(--text-2)] mb-8 max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/">
        <Button variant="primary">Go Home</Button>
      </Link>
    </div>
  )
}
