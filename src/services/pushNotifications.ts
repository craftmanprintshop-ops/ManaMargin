/**
 * Web Push subscription management.
 *
 * Registers the service worker, subscribes the browser to push, and stores the
 * resulting endpoint in Supabase so the deal watcher can send to it.
 *
 * iOS caveat: Safari only exposes PushManager to web apps installed via
 * Share > Add to Home Screen. In a normal Safari tab the API is absent
 * entirely, which is why `getPushSupport()` reports *why* it is unavailable
 * rather than just returning false.
 */

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'unsupported' | 'ios-needs-install' | 'no-vapid-key' }

/** iOS/iPadOS, including iPadOS masquerading as desktop Safari. */
function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document)
}

/** True when running as an installed home-screen app rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function getPushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return { supported: false, reason: 'no-vapid-key' }

  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (hasApis) return { supported: true }

  // On iOS the APIs only appear once installed, so distinguish "you need to
  // install this" from "your browser will never do this".
  if (isIOS() && !isStandalone()) return { supported: false, reason: 'ios-needs-install' }
  return { supported: false, reason: 'unsupported' }
}

/**
 * VAPID keys are base64url; PushManager wants raw bytes.
 * Backed by an explicit ArrayBuffer so the result satisfies BufferSource —
 * a plain `new Uint8Array(n)` widens to ArrayBufferLike and is rejected.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

type PushSubscriptionInsert = {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string
  enabled: boolean
  failure_count: number
  last_error: string | null
}

/**
 * Inserts the subscription row.
 *
 * The cast is deliberate. postgrest-js requires `Relationships` on every entry
 * in the Database type, and this repo's hand-maintained `src/types/database.ts`
 * omits it throughout — so *any* typed write resolves to `never`, not just this
 * one. Reads are unaffected, which is why it has gone unnoticed. Reshaping that
 * whole file is a separate change; the payload stays type-checked here via
 * PushSubscriptionInsert.
 */
async function upsertSubscription(
  row: PushSubscriptionInsert,
): Promise<{ error: { message: string } | null }> {
  const table = supabase.from('push_subscriptions') as unknown as {
    upsert: (
      values: PushSubscriptionInsert,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message: string } | null }>
  }
  return table.upsert(row, { onConflict: 'endpoint' })
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

/** Whether this browser currently has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!getPushSupport().supported) return false
  if (Notification.permission !== 'granted') return false
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) return false
  return (await registration.pushManager.getSubscription()) !== null
}

export type SubscribeResult = { ok: true } | { ok: false; error: string }

/**
 * Must be called from a user gesture — iOS rejects permission prompts that
 * aren't tied to a direct interaction.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  const support = getPushSupport()
  if (!support.supported) {
    const messages: Record<string, string> = {
      'ios-needs-install': 'On iPhone, add ManaMargin to your Home Screen first (Share → Add to Home Screen), then enable alerts from there.',
      'no-vapid-key': 'Push notifications are not configured on this deployment.',
      unsupported: 'This browser does not support push notifications.',
    }
    return { ok: false, error: messages[support.reason] }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sign in first so alerts can be tied to your account.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      ok: false,
      error:
        permission === 'denied'
          ? 'Notifications are blocked. Enable them for this site in your browser settings.'
          : 'Notification permission was dismissed.',
    }
  }

  try {
    const registration = await getRegistration()
    await navigator.serviceWorker.ready

    // Reuse an existing subscription if the browser already has one; calling
    // subscribe() twice with the same key returns the same endpoint anyway.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      }))

    const json = subscription.toJSON()
    if (!json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: 'Browser returned an incomplete subscription.' }
    }

    const row: PushSubscriptionInsert = {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      enabled: true,
      failure_count: 0,
      last_error: null,
    }

    // onConflict=endpoint so re-enabling on the same device updates the row
    // (and clears any failure count) instead of erroring on the unique index.
    const { error } = await upsertSubscription(row)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Subscription failed.' }
  }
}

export async function unsubscribeFromPush(): Promise<SubscribeResult> {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()

    if (subscription) {
      // Remove the stored row first — if the browser-side unsubscribe succeeds
      // but the delete fails, the watcher would keep pushing to a dead endpoint.
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', subscription.endpoint)
      if (error) return { ok: false, error: error.message }

      await subscription.unsubscribe()
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unsubscribe failed.' }
  }
}
