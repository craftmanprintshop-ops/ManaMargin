-- Migration 012: Fix Stale Prices in EV View
-- Run in Supabase SQL Editor AFTER 011
--
-- Problem:
--   v_ev_with_best_offers queries the raw `offers` table without any recency
--   filter. It picks the cheapest price EVER scraped (e.g., $189.99 from weeks
--   ago) instead of the CURRENT price ($209.99). Every scrape inserts a new row,
--   so old prices accumulate.
--
-- Fix:
--   Only consider offers from the most recent scrape per marketplace.
--   Each scraper crawls the entire site, so if a product wasn't found in the
--   latest scrape, it's no longer available. Older data is kept for history only.

-- ============================================================
-- STEP 1: Create a helper view for latest scrape timestamp per marketplace
-- ============================================================
-- This finds the most recent fetched_at per marketplace, so we only use
-- offers from that scrape run (not historical data).
CREATE OR REPLACE VIEW marketplace_latest_scrape AS
SELECT marketplace, MAX(fetched_at) AS latest_fetched_at
FROM offers
WHERE scrape_ok = true
GROUP BY marketplace;

-- ============================================================
-- STEP 2: Create a view for current offers only
-- ============================================================
-- Only includes offers from the most recent scrape per marketplace.
-- If a product wasn't found in the latest scrape, it's considered unavailable.
CREATE OR REPLACE VIEW offers_current AS
SELECT o.*
FROM offers o
JOIN marketplace_latest_scrape mls
  ON o.marketplace = mls.marketplace
  AND o.fetched_at = mls.latest_fetched_at
WHERE o.scrape_ok = true
  AND o.canonical_product_id IS NOT NULL;

-- ============================================================
-- STEP 3: Recreate v_ev_with_best_offers using current offers only
-- ============================================================
CREATE OR REPLACE VIEW v_ev_with_best_offers AS
SELECT
  cp.id AS canonical_product_id,
  cp.set_name,
  cp.product_type,
  cp.set_type,
  b.set_code,
  b.product_name AS botbox_product_name,
  b.expected_value,
  b.market_price AS botbox_market_price,
  b.ev_to_price_ratio,
  b.calculation_timestamp,
  b.fetched_at AS botbox_fetched_at,
  -- Best price: use direct offer, or sum of individual decks (only when ALL matched)
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.marketplace
    WHEN deck_sum.sum_total IS NOT NULL
      THEN 'Individual Decks'
    ELSE NULL
  END AS best_marketplace,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.price
    WHEN deck_sum.sum_total IS NOT NULL
      THEN deck_sum.sum_total
    ELSE NULL
  END AS best_price,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.shipping
    ELSE 0::numeric
  END AS best_shipping,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN (best.price + COALESCE(best.shipping, 0))
    WHEN deck_sum.sum_total IS NOT NULL
      THEN deck_sum.sum_total
    ELSE NULL
  END AS best_total,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.url
    ELSE NULL
  END AS best_url,
  deck_sum.total_decks AS individual_deck_count,
  deck_sum.decks_with_offers AS individual_decks_matched
FROM botbox_ev_calculations b
JOIN botbox_product_mappings bpm ON (
  bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
)
JOIN canonical_products cp ON cp.id = bpm.canonical_product_id
-- Direct best offer: from current scrape data only
LEFT JOIN LATERAL (
  SELECT o.marketplace, o.price, o.shipping, o.url
  FROM offers_current o
  WHERE o.canonical_product_id = cp.id
    AND o.in_stock = true
    AND o.is_sealed = true
  ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
  LIMIT 1
) best ON true
-- Sum of individual deck best prices (only for Commander Deck Set)
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(*) = count(ind_best.best_total) THEN sum(ind_best.best_total) ELSE NULL END AS sum_total,
    count(*) AS total_decks,
    count(ind_best.best_total) AS decks_with_offers
  FROM canonical_products ind_cp
  LEFT JOIN LATERAL (
    SELECT (o.price + COALESCE(o.shipping, 0)) AS best_total
    FROM offers_current o
    WHERE o.canonical_product_id = ind_cp.id
      AND o.in_stock = true
      AND o.is_sealed = true
    ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
    LIMIT 1
  ) ind_best ON true
  WHERE ind_cp.set_name = cp.set_name
    AND ind_cp.product_type LIKE 'Commander Deck %'
    AND ind_cp.product_type NOT IN (
      'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
      'Commander Deck Collector Edition'
    )
) deck_sum ON cp.product_type IN ('Commander Deck Set', 'Commander Deck Display')
WHERE b.expected_value IS NOT NULL
ORDER BY b.ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON marketplace_latest_scrape TO anon, authenticated;
GRANT SELECT ON offers_current TO anon, authenticated;
GRANT SELECT ON v_ev_with_best_offers TO anon, authenticated;

-- Drop the old view from the first version of this migration (if it exists)
DROP VIEW IF EXISTS offers_latest_by_product;

-- ============================================================
-- STEP 4: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 5: Verify Doctor Who pricing
-- ============================================================
SELECT
  set_name,
  product_type,
  best_marketplace,
  best_total,
  best_url
FROM v_ev_with_best_offers
WHERE set_name = 'Doctor Who'
ORDER BY product_type;
