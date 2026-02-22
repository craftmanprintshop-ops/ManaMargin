/**
 * useInventory Hook
 *
 * Manages sealed product inventory in localStorage.
 * Tracks owned products with cost, count, fees, and shipping.
 */

import { useState, useEffect, useCallback } from 'react'

export interface InventoryItem {
  id: string
  setName: string
  productType: string
  title: string // original marketplace title for reference
  costPaid: number
  count: number
  feePercent: number // e.g. 15 for 15%
  shippingCost: number
  addedAt: string
}

const STORAGE_KEY = 'manamargin_inventory'

function loadInventory(): InventoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveInventory(items: InventoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useInventory() {
  const [items, setItems] = useState<InventoryItem[]>(loadInventory)

  // Persist on change
  useEffect(() => {
    saveInventory(items)
  }, [items])

  const addItem = useCallback((item: Omit<InventoryItem, 'id' | 'addedAt'>) => {
    setItems(prev => {
      // Check if already exists by setName + productType
      const existing = prev.find(
        i => i.setName === item.setName && i.productType === item.productType
      )
      if (existing) return prev // already in inventory
      const id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      return [...prev, {
        ...item,
        id,
        addedAt: new Date().toISOString(),
      }]
    })
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const updateItem = useCallback((id: string, updates: Partial<InventoryItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
  }, [])

  const isInInventory = useCallback((setName: string, productType: string) => {
    return items.some(i => i.setName === setName && i.productType === productType)
  }, [items])

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

  return { items, addItem, removeItem, updateItem, isInInventory, toggleItem }
}
