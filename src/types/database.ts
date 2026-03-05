export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      offers: {
        Row: {
          id: string
          canonical_sku: string | null
          marketplace: string | null
          source_key: string | null
          title: string | null
          price: number | null
          shipping: number | null
          in_stock: boolean | null
          url: string | null
          image_url: string | null
          fetched_at: string | null
          created_at: string | null
          scrape_ok: boolean | null
          set_name: string | null
          set_type: string | null
          product_type: string | null
          foil: string | null
          is_sealed: boolean | null
          canonical_product_id: number | null
        }
        Insert: {
          id?: string
          canonical_sku?: string | null
          marketplace?: string | null
          source_key?: string | null
          title?: string | null
          price?: number | null
          shipping?: number | null
          in_stock?: boolean | null
          url?: string | null
          image_url?: string | null
          fetched_at?: string | null
          created_at?: string | null
          scrape_ok?: boolean | null
          set_name?: string | null
          set_type?: string | null
          product_type?: string | null
          foil?: string | null
          is_sealed?: boolean | null
          canonical_product_id?: number | null
        }
        Update: {
          id?: string
          canonical_sku?: string | null
          marketplace?: string | null
          source_key?: string | null
          title?: string | null
          price?: number | null
          shipping?: number | null
          in_stock?: boolean | null
          url?: string | null
          image_url?: string | null
          fetched_at?: string | null
          created_at?: string | null
          scrape_ok?: boolean | null
          set_name?: string | null
          set_type?: string | null
          product_type?: string | null
          foil?: string | null
          is_sealed?: boolean | null
          canonical_product_id?: number | null
        }
      }
      tracked_products: {
        Row: {
          canonical_sku: string
          display_name: string | null
          active: boolean | null
        }
        Insert: {
          canonical_sku: string
          display_name?: string | null
          active?: boolean | null
        }
        Update: {
          canonical_sku?: string
          display_name?: string | null
          active?: boolean | null
        }
      }
      cards: {
        Row: {
          uuid: string
          name: string | null
          set_code: string | null
          set_name: string | null
          rarity: string | null
          mana_cost: string | null
          type: string | null
          text: string | null
          power: string | null
          toughness: string | null
          number: string | null
          availability: string | null
          side: string | null
        }
        Insert: {
          uuid: string
          name?: string | null
          set_code?: string | null
          set_name?: string | null
          rarity?: string | null
          mana_cost?: string | null
          type?: string | null
          text?: string | null
          power?: string | null
          toughness?: string | null
          number?: string | null
          availability?: string | null
          side?: string | null
        }
        Update: {
          uuid?: string
          name?: string | null
          set_code?: string | null
          set_name?: string | null
          rarity?: string | null
          mana_cost?: string | null
          type?: string | null
          text?: string | null
          power?: string | null
          toughness?: string | null
          number?: string | null
          availability?: string | null
          side?: string | null
        }
      }
      commander_decks: {
        Row: {
          code: string
          file_name: string
          deck_name: string | null
          commanders: string[] | null
          release_date: string | null
        }
        Insert: {
          code: string
          file_name: string
          deck_name?: string | null
          commanders?: string[] | null
          release_date?: string | null
        }
        Update: {
          code?: string
          file_name?: string
          deck_name?: string | null
          commanders?: string[] | null
          release_date?: string | null
        }
      }
      user_inventory: {
        Row: {
          id: string
          user_id: string
          set_name: string
          product_type: string
          title: string
          cost_paid: number
          count: number
          fee_percent: number
          shipping_cost: number
          added_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          set_name: string
          product_type: string
          title: string
          cost_paid?: number
          count?: number
          fee_percent?: number
          shipping_cost?: number
        }
        Update: {
          cost_paid?: number
          count?: number
          fee_percent?: number
          shipping_cost?: number
        }
      }
      commander_deck_cards: {
        Row: {
          code: string
          deck_name: string
          card_uuid: string | null
          card_name: string | null
          quantity: number | null
          is_commander: boolean | null
        }
        Insert: {
          code: string
          deck_name: string
          card_uuid?: string | null
          card_name?: string | null
          quantity?: number | null
          is_commander?: boolean | null
        }
        Update: {
          code?: string
          deck_name?: string
          card_uuid?: string | null
          card_name?: string | null
          quantity?: number | null
          is_commander?: boolean | null
        }
      }
    }
    Views: {
      offers_latest_enriched: {
        Row: {
          id: string | null
          canonical_sku: string | null
          marketplace: string | null
          source_key: string | null
          title: string | null
          display_name: string | null
          price: number | null
          shipping: number | null
          in_stock: boolean | null
          url: string | null
          image_url: string | null
          fetched_at: string | null
          set_name: string | null
          set_type: string | null
          product_type: string | null
          foil: string | null
        }
      }
      offers_dropdown_sets: {
        Row: {
          set_name: string | null
        }
      }
      offers_dropdown_product_types: {
        Row: {
          product_type: string | null
        }
      }
      offers_dropdown_foil: {
        Row: {
          foil: string | null
        }
      }
      v_commander_deck_values: {
        Row: {
          code: string | null
          file_name: string | null
          deck_name: string | null
          commanders: string[] | null
          release_date: string | null
          set_name: string | null
          total_value: number | null
          card_count: number | null
        }
      }
      v_commander_deck_card_details: {
        Row: {
          code: string | null
          deck_name: string | null
          card_uuid: string | null
          card_name: string | null
          quantity: number | null
          count: number | null
          is_commander: boolean | null
          is_foil: boolean | null
          set_code: string | null
          rarity: string | null
          price: number | null
          total_card_value: number | null
        }
      }
      v_cards_by_set_rarity: {
        Row: {
          set_code: string | null
          rarity: string | null
          card_count: number | null
        }
      }
      v_card_latest_price: {
        Row: {
          uuid: string | null
          name: string | null
          set_code: string | null
          rarity: string | null
          price: number | null
        }
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
