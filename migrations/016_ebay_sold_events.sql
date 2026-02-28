-- Migration 016: Create ebay_sold_events table
-- Replaces watchcount_sold_events with direct eBay sold listings data
-- Does NOT drop the old table (kept for historical reference)

CREATE TABLE IF NOT EXISTS ebay_sold_events (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query           text NOT NULL,
  title           text,
  sold_date_utc   timestamptz,
  sold_date_raw   text,
  price_usd       numeric,
  shipping_cost   numeric,
  condition       text,
  type            text,
  bids            int,
  sold_count      int,
  ebay_item_id    text,
  ebay_url        text,
  image_url       text,
  scraped_at      timestamptz NOT NULL DEFAULT now()
);

-- Primary dedupe: same eBay item + date + price
CREATE UNIQUE INDEX IF NOT EXISTS uq_ebay_sold_ebay
  ON ebay_sold_events (ebay_item_id, sold_date_utc, price_usd)
  WHERE ebay_item_id IS NOT NULL;

-- Fallback dedupe: when ebay_item_id could not be parsed
CREATE UNIQUE INDEX IF NOT EXISTS uq_ebay_sold_fallback
  ON ebay_sold_events (query, sold_date_raw, price_usd, title)
  WHERE ebay_item_id IS NULL;

-- Query performance
CREATE INDEX IF NOT EXISTS idx_ebay_sold_query_date
  ON ebay_sold_events (query, sold_date_utc DESC);
CREATE INDEX IF NOT EXISTS idx_ebay_sold_ebay_item
  ON ebay_sold_events (ebay_item_id);
CREATE INDEX IF NOT EXISTS idx_ebay_sold_scraped
  ON ebay_sold_events (scraped_at DESC);

-- RLS
ALTER TABLE ebay_sold_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read ebay_sold"
  ON ebay_sold_events FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert ebay_sold"
  ON ebay_sold_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update ebay_sold"
  ON ebay_sold_events FOR UPDATE USING (true) WITH CHECK (true);
