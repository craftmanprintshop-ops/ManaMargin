/**
 * App Component
 *
 * Main application component with routing and layout.
 * Sets up React Router and wraps all pages with header/footer.
 */

import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { Dashboard } from './pages/Dashboard'
import { Products } from './pages/Products'
import { ProductsSimple } from './pages/ProductsSimple'
import { CommanderDecks } from './pages/CommanderDecks'
import { CommanderDecksGrouped } from './pages/CommanderDecksGrouped'
import { CommanderDeckDetail } from './pages/CommanderDeckDetail'
import { CommanderDeckDetailGrid } from './pages/CommanderDeckDetailGrid'
import { EVCalculations } from './pages/EVCalculations'
import { PriceCompare } from './pages/PriceCompare'
import { NotFound } from './pages/NotFound'
import { DatabaseDiagnostic } from './pages/DatabaseDiagnostic'
import { Inventory } from './pages/Inventory'
import { ROUTES } from './utils/constants'

/**
 * Main application component
 */
/**
 * Commander Decks Wrapper - handles navigation to deck detail
 */
const CommanderDecksWrapper: React.FC = () => {
  const navigate = useNavigate()

  const handleDeckSelect = (code: string, fileName: string) => {
    navigate(`/commander-decks/${code}/${fileName}`)
  }

  return <CommanderDecksGrouped onDeckSelect={handleDeckSelect} />
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-gray-900">
        {/* Header */}
        <Header />

        {/* Main Content */}
        <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ErrorBoundary>
            <Routes>
              {/* Home redirects to Dashboard */}
              <Route path={ROUTES.HOME} element={<Navigate to={ROUTES.DASHBOARD} replace />} />

              {/* Dashboard */}
              <Route path={ROUTES.DASHBOARD} element={<Dashboard />} />

              {/* Products - Simple set summary table */}
              <Route path={ROUTES.PRODUCTS} element={<ProductsSimple />} />
              <Route path="/products/detailed" element={<Products />} />

              {/* Price Compare - Marketplace price comparison */}
              <Route path={ROUTES.PRICE_COMPARE} element={<PriceCompare />} />

              {/* EV Calculations */}
              <Route path={ROUTES.EV_CALCULATIONS} element={<EVCalculations />} />

              {/* Commander Decks - Grouped table layout */}
              <Route path={ROUTES.COMMANDER_DECKS} element={<CommanderDecksWrapper />} />
              <Route path="/commander-decks/:code/:fileName" element={<CommanderDeckDetailGrid />} />

              {/* Alternative commander decks routes */}
              <Route path="/commander-decks/list" element={<CommanderDecks />} />
              <Route path="/commander-decks/detail/:code/:fileName" element={<CommanderDeckDetail />} />

              {/* Inventory */}
              <Route path={ROUTES.INVENTORY} element={<Inventory />} />

              {/* Database Diagnostic - Hidden route for troubleshooting */}
              <Route path="/diagnostic" element={<DatabaseDiagnostic />} />

              {/* 404 Not Found */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <Footer />
      </div>
    </BrowserRouter>
  )
}

export default App
