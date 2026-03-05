-- Migration 017: Migrate old ebay_sold_events query format
-- Old format: "mtg Set Name Product Type" (no quotes)
-- New format: '"Set Name Product Type"' (with literal double quotes)
--
-- The unique index on (ebay_item_id, sold_date_utc, price_usd) does NOT include
-- query, so updating query won't violate that constraint.
--
-- For the fallback index (query, sold_date_raw, price_usd, title) WHERE ebay_item_id IS NULL,
-- we need to handle potential conflicts.

-- Step 1: Update rows WITH ebay_item_id (safe, no query in unique index)
UPDATE ebay_sold_events
SET query = '"' || substring(query from 5) || '"'
WHERE query LIKE 'mtg %'
  AND ebay_item_id IS NOT NULL;

-- Step 2: For rows WITHOUT ebay_item_id, delete ones that would conflict,
-- then update the rest
DELETE FROM ebay_sold_events old
WHERE old.query LIKE 'mtg %'
  AND old.ebay_item_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ebay_sold_events new
    WHERE new.query = '"' || substring(old.query from 5) || '"'
      AND new.sold_date_raw = old.sold_date_raw
      AND new.price_usd = old.price_usd
      AND new.title = old.title
      AND new.ebay_item_id IS NULL
  );

UPDATE ebay_sold_events
SET query = '"' || substring(query from 5) || '"'
WHERE query LIKE 'mtg %'
  AND ebay_item_id IS NULL;
