/**
 * Header Component
 *
 * Main navigation header for the application.
 * Contains logo, navigation links, and mobile hamburger menu.
 */

import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'

/**
 * Application header with navigation
 */
export const Header: React.FC = () => {
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isMobileMenuOpen])

  // Navigation links
  const navLinks = [
    { path: ROUTES.DASHBOARD, label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
    { path: ROUTES.PRODUCTS, label: 'Products', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
    { path: ROUTES.PRICE_COMPARE, label: 'Price Compare', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { path: ROUTES.EV_CALCULATIONS, label: 'EV Calculations', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
    { path: ROUTES.COMMANDER_DECKS, label: 'Commander Decks', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { path: ROUTES.INVENTORY, label: 'Inventory', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
  ]

  // Check if a link is active
  const isActive = (path: string) => {
    if (path === ROUTES.DASHBOARD) {
      return location.pathname === path || location.pathname === ROUTES.HOME
    }
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <header className="bg-[#0f111a]/95 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link
              to={ROUTES.HOME}
              className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 transition-colors shrink-0"
            >
              <div className="flex items-center">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-primary-600 to-primary-800 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-lg sm:text-xl">M</span>
                </div>
                <span className="ml-2 sm:ml-3 text-xl sm:text-2xl font-bold text-white">
                  Mana<span className="text-primary-600">Margin</span>
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <nav className="hidden lg:flex space-x-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`
                    px-3 xl:px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap
                    ${
                      isActive(link.path)
                        ? 'bg-[var(--brand)]/20 text-[var(--brand)]'
                        : 'text-[var(--text-2)] hover:bg-white/5 hover:text-white'
                    }
                  `}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Mobile Menu Button */}
            <button
              className="lg:hidden p-2 rounded-lg text-[var(--text-2)] hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)] transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? (
                /* X icon */
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                /* Hamburger icon */
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Menu Panel */}
      <div
        className={`
          fixed top-0 right-0 z-50 h-full w-72 sm:w-80
          bg-[#0b0d14] border-l border-white/10 shadow-2xl
          transform transition-transform duration-300 ease-in-out
          lg:hidden
          ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Mobile Menu Header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/10">
          <span className="text-sm font-bold text-white uppercase tracking-widest">Menu</span>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg text-[var(--text-2)] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mobile Menu Links */}
        <nav className="px-3 py-4 space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
                ${
                  isActive(link.path)
                    ? 'bg-[var(--brand)]/15 text-[var(--brand)] border border-[var(--brand)]/20'
                    : 'text-[var(--text-2)] hover:bg-white/5 hover:text-white border border-transparent'
                }
              `}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={link.icon} />
              </svg>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  )
}
