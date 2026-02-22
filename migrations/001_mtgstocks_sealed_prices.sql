-- MTGStocks Sealed Prices Table
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Stores scraped sealed product pricing from mtgstocks.com/sealed
-- Each scrape run inserts new rows (historical tracking)

CREATE TABLE IF NOT EXISTS mtgstocks_sealed_prices (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  set_name        text NOT NULL,           -- e.g. "Modern Horizons 3", "Bloomburrow"
  product_name    text NOT NULL,           -- e.g. "Collector Booster Display", "Play Booster Pack"
  product_type    text,                    -- e.g. "Pack", "Display", "Case", "Bundle", "Deck"
  mtgstocks_id    integer,                -- numeric ID from mtgstocks URL (e.g. 7234)
  mtgstocks_slug  text,                   -- full slug from URL (e.g. "7234-collector-booster-display-master-case")
  avg_price       numeric,                -- MTGStocks average price
  market_price    numeric,                -- MTGStocks market price
  url             text,                   -- full URL to mtgstocks product page
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by set + product
CREATE INDEX IF NOT EXISTS idx_mtgstocks_sealed_set_product
  ON mtgstocks_sealed_prices (set_name, product_name);

-- Index for latest prices per product
CREATE INDEX IF NOT EXISTS idx_mtgstocks_sealed_fetched
  ON mtgstocks_sealed_prices (fetched_at DESC);

-- Index for mtgstocks_id lookups
CREATE INDEX IF NOT EXISTS idx_mtgstocks_sealed_id
  ON mtgstocks_sealed_prices (mtgstocks_id);

-- Enable RLS but allow service_role full access
ALTER TABLE mtgstocks_sealed_prices ENABLE ROW LEVEL SECURITY;

-- Allow anon/authenticated to read
CREATE POLICY "Allow public read access" ON mtgstocks_sealed_prices
  FOR SELECT USING (true);

-- Allow service_role to insert (scraper)
CREATE POLICY "Allow service_role insert" ON mtgstocks_sealed_prices
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- View: latest MTGStocks price per product (most recent scrape)
-- ============================================================
CREATE OR REPLACE VIEW v_mtgstocks_sealed_latest AS
SELECT DISTINCT ON (mtgstocks_id)
  id,
  set_name,
  product_name,
  product_type,
  mtgstocks_id,
  mtgstocks_slug,
  avg_price,
  market_price,
  url,
  fetched_at
FROM mtgstocks_sealed_prices
WHERE mtgstocks_id IS NOT NULL
ORDER BY mtgstocks_id, fetched_at DESC;

-- ============================================================
-- View: MTGStocks commander deck prices (for merging with commander page)
-- Filters to product_type = 'Deck' only
-- ============================================================
CREATE OR REPLACE VIEW v_mtgstocks_commander_prices AS
SELECT
  set_name,
  product_name,
  avg_price,
  market_price,
  url,
  fetched_at
FROM v_mtgstocks_sealed_latest
WHERE product_type = 'Deck';

-- ============================================================
-- View: MTGStocks sealed product prices for price comparison
-- Enriches with product type categorization
-- ============================================================
CREATE OR REPLACE VIEW v_mtgstocks_sealed_for_compare AS
SELECT
  set_name,
  product_name,
  product_type,
  avg_price,
  market_price,
  url,
  fetched_at,
  mtgstocks_id,
  -- Categorize for merging with offers
  CASE
    WHEN product_type IN ('Display', 'Master Case', 'Display Case')
      AND product_name ILIKE '%collector%' THEN 'Collector Booster Box'
    WHEN product_type IN ('Display', 'Master Case', 'Display Case')
      AND product_name ILIKE '%set%' THEN 'Set Booster Box'
    WHEN product_type IN ('Display', 'Master Case', 'Display Case') THEN 'Play Booster Box'
    WHEN product_type = 'Pack'
      AND product_name ILIKE '%collector%' THEN 'Collector Booster Pack'
    WHEN product_type = 'Pack' THEN 'Play Booster Pack'
    WHEN product_type = 'Bundle' THEN 'Bundle'
    WHEN product_type = 'Deck' THEN 'Commander Deck'
    WHEN product_type = 'Case' THEN 'Case'
    ELSE product_type
  END AS normalized_product_type
FROM v_mtgstocks_sealed_latest;

COMMENT ON TABLE mtgstocks_sealed_prices IS 'Scraped sealed product pricing from mtgstocks.com. Historical rows per scrape run.';
