/* ManaMargin service worker — push notifications only.
 *
 * Deliberately does NOT cache anything. A caching service worker on a
 * price-tracking site risks serving stale prices, which is worse than a slow
 * load. Its only job is receiving push events and opening the right page.
 */

// Activate immediately rather than waiting for all tabs to close, so an
// updated worker starts handling pushes on the next visit.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A non-JSON push still deserves a notification rather than silence.
    payload = { title: 'ManaMargin', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'ManaMargin deal alert'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Same tag replaces an earlier notification for the same post instead of
    // stacking duplicates if the watcher retries.
    tag: payload.tag || 'manamargin-deal',
    renotify: true,
    requireInteraction: false,
    data: { url: payload.url || '/dashboard' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open ManaMargin window when there is one.
      for (const client of clients) {
        if ('focus' in client) {
          if (client.url === target) return client.focus()
          if ('navigate' in client) return client.focus().then((c) => c.navigate(target))
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
