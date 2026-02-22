-- Migration 005: Reclassify collector booster items
--
-- The first run of 002 classified collector items as "Booster Box" / "Booster Pack"
-- before the collector type fix was added. Re-run won't overwrite due to COALESCE.
-- This targeted update fixes those specific items.

-- Collector Booster Box: title contains "collector booster" + (box/display)
UPDATE offers
SET product_type = 'Collector Booster Box'
WHERE product_type IN ('Booster Box', 'Collector Booster Display')
  AND (lower(title) LIKE '%collector booster display%'
    OR lower(title) LIKE '%collector booster box%');

-- Collector Booster Pack: title contains "collector booster pack" or just "collector booster" (not box/display)
UPDATE offers
SET product_type = 'Collector Booster Pack'
WHERE product_type = 'Booster Pack'
  AND (lower(title) LIKE '%collector booster pack%'
    OR lower(title) LIKE '%collector booster%');

-- Also fix SC_ codes: _CB suffix = Collector Booster
UPDATE offers
SET product_type = 'Collector Booster Box'
WHERE product_type IN ('Collector Booster Display', 'Booster Box')
  AND title LIKE 'SC_%'
  AND (title LIKE '%_CB' OR title LIKE '%_CB_%' OR title LIKE '%_CBD%');

-- Refresh the MV
REFRESH MATERIALIZED VIEW offers_latest_enriched_mv;
