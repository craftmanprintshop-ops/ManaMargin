-- Migration 004: Make MV read classified columns directly from offers
--
-- Problem: The MV uses mtg_offer_meta(title) to recompute set_name/product_type
-- on the fly, ignoring the already-classified columns on the offers table.
-- This means migration 002's backfill and trigger classification are invisible to the MV.
--
-- Fix:
-- 1. Add classified columns to offers_latest view
-- 2. Recreate the MV to read those columns directly instead of using mtg_offer_meta()

-- Step 1: Update offers_latest to include classification columns
CREATE OR REPLACE VIEW offers_latest AS
SELECT DISTINCT ON (canonical_sku, marketplace)
    id,
    canonical_sku,
    marketplace,
    source_key,
    title,
    price,
    shipping,
    in_stock,
    url,
    image_url,
    fetched_at,
    created_at,
    set_name,
    set_type,
    product_type,
    foil,
    is_sealed
FROM offers
WHERE scrape_ok = true
ORDER BY canonical_sku, marketplace, fetched_at DESC;

-- Step 2: Drop and recreate the materialized view to read columns directly
-- (DROP is needed because we're changing the column source)
DROP MATERIALIZED VIEW IF EXISTS offers_latest_enriched_mv;

CREATE MATERIALIZED VIEW offers_latest_enriched_mv AS
SELECT
    id,
    canonical_sku,
    marketplace,
    source_key,
    title,
    price,
    shipping,
    in_stock,
    url,
    image_url,
    fetched_at,
    created_at,
    set_name,
    set_type,
    product_type,
    foil
FROM offers_latest;

-- Step 3: Recreate indexes on the MV
CREATE INDEX IF NOT EXISTS idx_mv_set_name ON offers_latest_enriched_mv (set_name);
CREATE INDEX IF NOT EXISTS idx_mv_marketplace ON offers_latest_enriched_mv (marketplace);
CREATE INDEX IF NOT EXISTS idx_mv_product_type ON offers_latest_enriched_mv (product_type);
CREATE INDEX IF NOT EXISTS idx_mv_canonical_sku ON offers_latest_enriched_mv (canonical_sku);

-- Step 4: Update the refresh function to work with the new MV
CREATE OR REPLACE FUNCTION refresh_offers_latest_enriched_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW offers_latest_enriched_mv;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Grant access
GRANT SELECT ON offers_latest_enriched_mv TO anon, authenticated;

-- Done! The MV now reads set_name, product_type, etc. directly from the
-- offers table (as classified by the trigger and backfill in migration 002).
