-- Migration 003: Fix offers_latest deduplication
--
-- Problem: offers_latest uses DISTINCT ON (canonical_sku, marketplace, source_key)
-- which causes duplicates when the same product has different source_keys
-- (e.g. forgeandfire "category" scrapes vs "product" scrapes).
-- This results in 33 duplicate products showing on the PriceCompare page.
--
-- Fix: Remove source_key from DISTINCT ON so we keep only the single newest
-- scrape per canonical_sku + marketplace, regardless of source_key.
--
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- Step 1: Recreate offers_latest view without source_key in DISTINCT ON
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
    created_at
FROM offers
WHERE scrape_ok = true
ORDER BY canonical_sku, marketplace, fetched_at DESC;

-- Step 2: Refresh the materialized view to pick up the change
REFRESH MATERIALIZED VIEW offers_latest_enriched_mv;
