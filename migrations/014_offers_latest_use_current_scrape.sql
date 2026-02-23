-- Migration 014: Update offers_latest to use only current scrape data
-- Run in Supabase SQL Editor AFTER 013
--
-- Problem:
--   offers_latest uses DISTINCT ON (canonical_sku, marketplace) across ALL time.
--   This means products that disappeared from a marketplace (delisted, sold out)
--   still show up with their last-known price. Every page that reads from
--   offers_latest_enriched_mv (PriceCompare, Dashboard commander deals,
--   CommanderDecksGrouped, Inventory, dashboardService) sees stale products.
--
-- Fix:
--   Filter offers_latest to only include offers from the most recent scrape
--   per marketplace, using the marketplace_latest_scrape view from migration 012.
--   If a product wasn't found in the latest scrape, it's no longer available.

-- ============================================================
-- STEP 1: Update offers_latest view
-- ============================================================
CREATE OR REPLACE VIEW offers_latest AS
SELECT DISTINCT ON (canonical_sku, marketplace)
    o.id,
    o.canonical_sku,
    o.marketplace,
    o.source_key,
    o.title,
    o.price,
    o.shipping,
    o.in_stock,
    o.url,
    o.image_url,
    o.fetched_at,
    o.created_at,
    o.set_name,
    o.set_type,
    o.product_type,
    o.foil,
    o.is_sealed
FROM offers o
JOIN marketplace_latest_scrape mls
  ON o.marketplace = mls.marketplace
  AND o.fetched_at = mls.latest_fetched_at
WHERE o.scrape_ok = true
ORDER BY canonical_sku, marketplace, o.fetched_at DESC;

-- ============================================================
-- STEP 2: Refresh the materialized view with current data
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 3: Verify — compare old vs new counts
-- ============================================================
SELECT 'offers_latest_enriched_mv rows' AS metric, count(*)::text AS value
FROM offers_latest_enriched_mv
UNION ALL
SELECT 'offers_current rows', count(*)::text
FROM offers_current
UNION ALL
SELECT 'distinct marketplaces in MV', count(DISTINCT marketplace)::text
FROM offers_latest_enriched_mv;
