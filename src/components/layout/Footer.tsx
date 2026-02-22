/**
 * Footer Component
 *
 * Application footer with links and copyright information.
 */

import React from 'react'
import { Link } from 'react-router-dom'

/**
 * Application footer
 */
export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-gray-800 text-gray-300 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* About */}
          <div>
            <h3 className="text-white font-semibold mb-4">ManaMargin</h3>
            <p className="text-sm text-gray-400">
              Your edge in the Magic: The Gathering sealed-product market.
              Compare prices across multiple marketplaces, track expected value,
              and find the best deals on booster boxes, bundles, and collector
              products — all in one place.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/products" className="hover:text-white transition-colors">
                  Price Comparison
                </Link>
              </li>
              <li>
                <Link to="/ev-calculations" className="hover:text-white transition-colors">
                  EV Calculations
                </Link>
              </li>
              <li>
                <Link to="/commander-decks" className="hover:text-white transition-colors">
                  Commander Decks
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-semibold mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://mtgjson.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  MTGJSON Data
                </a>
              </li>
              <li>
                <a
                  href="https://scryfall.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Scryfall
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-gray-700 mt-8 pt-6 text-sm text-center text-gray-400">
          <p>© {currentYear} ManaMargin. All rights reserved.</p>
          <p className="mt-1">
            Wizards of the Coast, Magic: The Gathering, and their logos are trademarks of Wizards of the Coast LLC.
          </p>
        </div>
      </div>
    </footer>
  )
}
