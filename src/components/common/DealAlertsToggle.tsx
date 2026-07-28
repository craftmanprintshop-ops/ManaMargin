/**
 * Deal Alerts Toggle
 *
 * Opt-in switch for web push notifications, shown in the header settings
 * dropdown. Mirrors the theme toggle's styling.
 *
 * The switch only appears when push is actually usable. On iPhone that means
 * the site must be installed to the Home Screen first, so we show that
 * instruction instead of a control the user cannot successfully flip.
 */

import React, { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import {
  getPushSupport,
  isSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../services/pushNotifications'

export const DealAlertsToggle: React.FC = () => {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const support = getPushSupport()

  useEffect(() => {
    let cancelled = false
    isSubscribed().then((v) => {
      if (!cancelled) setEnabled(v)
    })
    return () => { cancelled = true }
  }, [user])

  const handleToggle = async () => {
    setBusy(true)
    setError(null)
    const result = enabled ? await unsubscribeFromPush() : await subscribeToPush()
    if (result.ok) {
      setEnabled(!enabled)
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  const bell = (
    <svg className="w-4 h-4 text-[var(--brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  )

  const label = (
    <div className="flex items-center gap-2">
      {bell}
      <span className="text-sm font-medium text-[var(--text-1)]">Deal Alerts</span>
    </div>
  )

  // iPhone in a Safari tab: push is genuinely impossible until installed.
  if (!support.supported && support.reason === 'ios-needs-install') {
    return (
      <div className="p-3 border-t border-[var(--border-color-2)]">
        {label}
        <p className="text-[10px] text-[var(--text-2)] mt-1.5 leading-relaxed">
          To get alerts on iPhone, tap Share → <span className="font-semibold">Add to Home Screen</span>,
          then open ManaMargin from your home screen and turn this on.
        </p>
      </div>
    )
  }

  if (!support.supported) {
    return (
      <div className="p-3 border-t border-[var(--border-color-2)]">
        {label}
        <p className="text-[10px] text-[var(--text-2)] mt-1.5">
          {support.reason === 'no-vapid-key'
            ? 'Not configured on this deployment.'
            : 'This browser does not support push notifications.'}
        </p>
      </div>
    )
  }

  return (
    <div className="p-3 border-t border-[var(--border-color-2)]">
      <div className="flex items-center justify-between">
        {label}
        <button
          onClick={handleToggle}
          disabled={busy || !user}
          className={`relative w-11 h-6 rounded-full transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
            enabled ? 'bg-[var(--brand)]' : 'bg-[var(--text-2)]/40'
          }`}
          aria-label="Toggle deal alerts"
          aria-pressed={enabled}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {!user && (
        <p className="text-[10px] text-[var(--text-2)] mt-1.5">Sign in to enable alerts.</p>
      )}
      {user && !error && (
        <p className="text-[10px] text-[var(--text-2)] mt-1.5">
          {enabled
            ? 'Push alerts on for this device when a sealed deal beats market.'
            : 'Get pushed when a sealed deal beats market price.'}
        </p>
      )}
      {error && <p className="text-[10px] text-[var(--color-negative)] mt-1.5">{error}</p>}
    </div>
  )
}
