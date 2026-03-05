/**
 * useInventory Hook
 *
 * Manages sealed product inventory.
 * When a userId is provided (logged in), stores in Supabase user_inventory table.
 * Otherwise falls back to localStorage.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../services/supabase'

export interface InventoryItem {
  id: string
  setName: string
  productType: string
  title: string
  costPaid: number
  count: number
  feePercent: number // e.g. 15 for 15%
  shippingCost: number
  addedAt: string
}

const STORAGE_KEY = 'manamargin_inventory'

// --- localStorage helpers ---

function loadLocalInventory(): InventoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveLocalInventory(items: InventoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function hasLocalInventory(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
  } catch { return false }
}

// --- Supabase row mapping ---

function rowToItem(row: any): InventoryItem {
  return {
    id: row.id,
    setName: row.set_name,
    productType: row.product_type,
    title: row.title,
    costPaid: parseFloat(row.cost_paid) || 0,
    count: row.count ?? 0,
    feePercent: parseFloat(row.fee_percent) || 15,
    shippingCost: parseFloat(row.shipping_cost) || 5,
    addedAt: row.added_at,
  }
}

export function useInventory(userId?: string | null) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const isRemote = !!userId

  // Debounce timer for remote updates
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // --- Load items ---
  useEffect(() => {
    if (isRemote) {
      setLoading(true)
      supabase
        .from('user_inventory')
        .select('*')
        .eq('user_id', userId!)
        .order('added_at', { ascending: false })
        .then(({ data, error }) => {
          if (!error && data) setItems(data.map(rowToItem))
          setLoading(false)
        })
    } else {
      setItems(loadLocalInventory())
    }
  }, [userId, isRemote])

  // --- Persist localStorage when not remote ---
  useEffect(() => {
    if (!isRemote) saveLocalInventory(items)
  }, [items, isRemote])

  // --- addItem ---
  const addItem = useCallback(async (item: Omit<InventoryItem, 'id' | 'addedAt'>) => {
    if (isRemote) {
      const { data, error } = await supabase
        .from('user_inventory')
        .insert({
          user_id: userId!,
          set_name: item.setName,
          product_type: item.productType,
          title: item.title,
          cost_paid: item.costPaid,
          count: item.count,
          fee_percent: item.feePercent,
          shipping_cost: item.shippingCost,
        })
        .select()
        .single()
      if (!error && data) {
        setItems(prev => [rowToItem(data), ...prev])
      }
    } else {
      setItems(prev => {
        const existing = prev.find(
          i => i.setName === item.setName && i.productType === item.productType
        )
        if (existing) return prev
        const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        return [...prev, { ...item, id, addedAt: new Date().toISOString() }]
      })
    }
  }, [isRemote, userId])

  // --- removeItem ---
  const removeItem = useCallback(async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    if (isRemote) {
      await supabase.from('user_inventory').delete().eq('id', id)
    }
  }, [isRemote])

  // --- updateItem (debounced Supabase writes) ---
  const updateItem = useCallback((id: string, updates: Partial<InventoryItem>) => {
    // Optimistic local update
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))

    if (isRemote) {
      // Clear previous debounce for this item
      if (debounceRef.current[id]) clearTimeout(debounceRef.current[id])

      debounceRef.current[id] = setTimeout(async () => {
        const dbUpdates: Record<string, any> = {}
        if (updates.costPaid !== undefined) dbUpdates.cost_paid = updates.costPaid
        if (updates.count !== undefined) dbUpdates.count = updates.count
        if (updates.feePercent !== undefined) dbUpdates.fee_percent = updates.feePercent
        if (updates.shippingCost !== undefined) dbUpdates.shipping_cost = updates.shippingCost
        if (Object.keys(dbUpdates).length > 0) {
          await supabase.from('user_inventory').update(dbUpdates).eq('id', id)
        }
        delete debounceRef.current[id]
      }, 500)
    }
  }, [isRemote])

  // --- isInInventory ---
  const isInInventory = useCallback((setName: string, productType: string) => {
    return items.some(i => i.setName === setName && i.productType === productType)
  }, [items])

  // --- toggleItem ---
  const toggleItem = useCallback((item: Omit<InventoryItem, 'id' | 'addedAt'>) => {
    const existing = items.find(
      i => i.setName === item.setName && i.productType === item.productType
    )
    if (existing) {
      removeItem(existing.id)
    } else {
      addItem(item)
    }
  }, [items, addItem, removeItem])

  // --- migrateFromLocalStorage ---
  const migrateFromLocalStorage = useCallback(async () => {
    if (!isRemote) return
    const localItems = loadLocalInventory()
    if (localItems.length === 0) return

    const rows = localItems.map(item => ({
      user_id: userId!,
      set_name: item.setName,
      product_type: item.productType,
      title: item.title,
      cost_paid: item.costPaid,
      count: item.count,
      fee_percent: item.feePercent,
      shipping_cost: item.shippingCost,
    }))

    const { error } = await supabase
      .from('user_inventory')
      .upsert(rows, { onConflict: 'user_id,set_name,product_type' })

    if (!error) {
      localStorage.removeItem(STORAGE_KEY)
      // Re-fetch from Supabase for canonical IDs
      const { data } = await supabase
        .from('user_inventory')
        .select('*')
        .eq('user_id', userId!)
        .order('added_at', { ascending: false })
      if (data) setItems(data.map(rowToItem))
    }
  }, [isRemote, userId])

  return { items, addItem, removeItem, updateItem, isInInventory, toggleItem, migrateFromLocalStorage, loading }
}
