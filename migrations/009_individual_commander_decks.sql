-- Migration 009: Individual Commander Deck Matching
-- Run in Supabase SQL Editor AFTER 008
--
-- Problem: All individual commander decks for a set share one canonical product
-- (e.g., "Doctor Who | Commander Deck"), so BotBox EV for "Masters of Evil" gets
-- matched to the marketplace price for "Blast From the Past". Each individual
-- deck needs its own canonical product.
--
-- Also: "Commander Deck Display" (the box of all decks) was being classified
-- as generic "Commander Deck" instead of "Commander Deck Set".
--
-- Fix: Create per-deck canonical products using the deck name as product_type,
-- re-map BotBox entries, and reclassify marketplace offers.

-- ============================================================
-- STEP 1: Create canonical products for each individual commander deck
-- from BotBox data. Extract the deck-specific name from BotBox product_name.
-- ============================================================

-- First, identify BotBox commander deck entries and their specific names
-- BotBox product_name format: "Doctor Who (WHO) Masters of Evil"
-- After stripping set name: "Masters of Evil"
-- We want product_type = "Masters of Evil" (the specific deck name)

INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT
  ks.set_name,
  -- Strip the set name (with code) from product_name to get deck-specific name
  trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  )) AS product_type,
  ks.set_type
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
WHERE b.expected_value IS NOT NULL
  -- Only for entries that detect_product_type classifies as commander-related
  AND detect_product_type(b.product_name) IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition')
  -- Make sure we get a non-empty deck name
  AND trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  )) != ''
  -- Skip generic "Commander Deck" or "Commander Deck Display" - those already have proper types
  AND lower(trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  ))) NOT IN ('commander deck', 'commander decks', 'commander deck display', 'commander deck set')
ON CONFLICT (set_name, product_type) DO NOTHING;

-- ============================================================
-- STEP 2: Re-map BotBox commander deck entries to specific canonical products
-- ============================================================

-- Delete old generic mappings for individual commander decks
-- (but NOT for display/set entries which should keep their generic mapping)
DELETE FROM botbox_product_mappings bpm
USING botbox_ev_calculations b
WHERE bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
  AND detect_product_type(b.product_name) IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition')
  -- Only delete if the BotBox product has a specific deck name (not generic)
  AND lower(trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  ))) NOT IN ('commander deck', 'commander decks', 'commander deck display', 'commander deck set');

-- Re-map to specific canonical products
INSERT INTO botbox_product_mappings (canonical_product_id, set_code, product_name)
SELECT DISTINCT ON (b.set_code, b.product_name)
  cp.id,
  b.set_code,
  b.product_name
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
JOIN canonical_products cp ON (
  cp.set_name = ks.set_name
  AND lower(cp.product_type) = lower(trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  )))
)
WHERE b.expected_value IS NOT NULL
  AND detect_product_type(b.product_name) IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition')
  AND lower(trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(
      trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')),
      '([().+*?^${}|[\]\\])', '\\\1', 'g'
    ) || '\s*',
    '', 'i'
  ))) NOT IN ('commander deck', 'commander decks', 'commander deck display', 'commander deck set')
ORDER BY b.set_code, b.product_name
ON CONFLICT (set_code, product_name) DO UPDATE
  SET canonical_product_id = EXCLUDED.canonical_product_id;

-- ============================================================
-- STEP 3: Reclassify marketplace offers for individual commander decks
-- Use the commander_deck_sets table to match deck names in offer titles
-- ============================================================

-- Update offers that are currently "Commander Deck" to specific deck names
-- by matching the deck name from commander_deck_sets in the title
UPDATE offers o
SET product_type = initcap(cds.deck_name),
    canonical_product_id = cp.id
FROM commander_deck_sets cds
JOIN canonical_products cp ON (
  cp.set_name = cds.set_name
  AND lower(cp.product_type) = lower(cds.deck_name)
)
WHERE o.product_type = 'Commander Deck'
  AND o.set_name = cds.set_name
  AND lower(o.title) LIKE '%' || lower(cds.deck_name) || '%';

-- Also try matching offers directly to BotBox deck names via canonical products
-- For decks not in commander_deck_sets but present in canonical_products
UPDATE offers o
SET canonical_product_id = cp.id,
    product_type = cp.product_type
FROM canonical_products cp
WHERE o.product_type = 'Commander Deck'
  AND o.set_name = cp.set_name
  AND cp.product_type NOT IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition')
  AND lower(o.title) LIKE '%' || lower(cp.product_type) || '%'
  -- Ensure we're matching specific deck names, not generic terms
  AND length(cp.product_type) > 5;

-- ============================================================
-- STEP 4: Handle "Commander Deck Display" / "Commander Deck Set" entries
-- BotBox entries with "Display" in name should map to "Commander Deck Set"
-- ============================================================

-- Make sure Commander Deck Display entries map to Commander Deck Set canonical
UPDATE botbox_product_mappings bpm
SET canonical_product_id = cp.id
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
JOIN canonical_products cp ON (
  cp.set_name = ks.set_name
  AND cp.product_type = 'Commander Deck Set'
)
WHERE bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
  AND (lower(b.product_name) LIKE '%commander deck display%'
       OR lower(b.product_name) LIKE '%commander decks%');

-- ============================================================
-- STEP 5: Update classify_offer() to set specific deck names
-- When a title contains a known deck name from commander_deck_sets,
-- set product_type to that deck name instead of generic "Commander Deck"
-- ============================================================

-- Add new deck names to commander_deck_sets that may be missing
-- (BotBox may have decks not in our original list)
INSERT INTO commander_deck_sets (deck_name, set_name)
SELECT DISTINCT
  lower(cp.product_type),
  cp.set_name
FROM canonical_products cp
WHERE cp.product_type NOT IN (
  'Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition',
  'Commander Deck Case', 'Collector Booster Box', 'Booster Box', 'Bundle',
  'Booster Pack', 'Pre Release Pack', 'Starter Kit', 'Starter Collection',
  'Scene Box', 'Theme Deck', 'Secret Lair', 'Jumpstart Booster Display',
  'Beginner Box', 'Draft Night Kit', 'Video Game Deck', 'Box Topper',
  'Scene Box Display', 'Collector Booster Pack'
)
-- Only for product types that look like deck names (not generic types)
AND length(cp.product_type) > 5
AND lower(cp.product_type) NOT LIKE '%booster%'
AND lower(cp.product_type) NOT LIKE '%bundle%'
AND lower(cp.product_type) NOT LIKE '%case%'
AND lower(cp.product_type) NOT LIKE '%display%'
AND lower(cp.product_type) NOT LIKE '%pack%'
AND lower(cp.product_type) NOT LIKE '%kit%'
AND lower(cp.product_type) NOT LIKE '%collection%'
ON CONFLICT (deck_name) DO NOTHING;

-- ============================================================
-- STEP 6: Recreate v_ev_with_best_offers with Commander Deck Set summing
-- For "Commander Deck Set" products, the best marketplace price is either:
--   a) A direct set/display offer, or
--   b) The sum of buying each individual deck at their best price
--      (ONLY when ALL individual decks have marketplace offers)
-- Whichever is cheaper.
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
  -- Best price: use direct offer, or sum of individual decks for sets (only when ALL decks matched)
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
  -- Deck count info for Commander Deck Sets (used by frontend for popup)
  deck_sum.total_decks AS individual_deck_count,
  deck_sum.decks_with_offers AS individual_decks_matched
FROM botbox_ev_calculations b
JOIN botbox_product_mappings bpm ON (
  bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
)
JOIN canonical_products cp ON cp.id = bpm.canonical_product_id
-- Direct best offer for this canonical product
LEFT JOIN LATERAL (
  SELECT o.marketplace, o.price, o.shipping, o.url
  FROM offers o
  WHERE o.canonical_product_id = cp.id
    AND o.in_stock = true
    AND o.is_sealed = true
  ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
  LIMIT 1
) best ON true
-- Sum of individual deck best prices (only computed for Commander Deck Set)
-- Uses LEFT JOIN so we count ALL decks, even those without offers
LEFT JOIN LATERAL (
  SELECT
    -- Only non-null when ALL decks have offers
    CASE WHEN count(*) = count(ind_best.best_total) THEN sum(ind_best.best_total) ELSE NULL END AS sum_total,
    count(*) AS total_decks,
    count(ind_best.best_total) AS decks_with_offers
  FROM canonical_products ind_cp
  LEFT JOIN LATERAL (
    SELECT (o.price + COALESCE(o.shipping, 0)) AS best_total
    FROM offers o
    WHERE o.canonical_product_id = ind_cp.id
      AND o.in_stock = true
      AND o.is_sealed = true
    ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
    LIMIT 1
  ) ind_best ON true
  WHERE ind_cp.set_name = cp.set_name
    -- Only individual deck canonical products (not sets, cases, etc.)
    AND ind_cp.product_type NOT IN (
      'Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition',
      'Commander Deck Case', 'Collector Booster Box', 'Booster Box', 'Bundle',
      'Booster Pack', 'Pre Release Pack', 'Starter Kit', 'Starter Collection',
      'Scene Box', 'Jumpstart Booster Display', 'Beginner Box', 'Theme Deck',
      'Draft Night Kit', 'Secret Lair', 'Box Topper', 'Video Game Deck',
      'Scene Box Display', 'Collector Booster Pack',
      'Collector Booster Box Case', 'Booster Box Case', 'Bundle Case',
      'Commander Deck Case', 'Starter Collection Case', 'Starter Kit Case',
      'Beginner Box Case', 'Scene Box Case', 'Pre Release Pack Case',
      'Jumpstart Booster Display Case'
    )
    AND length(ind_cp.product_type) > 3
) deck_sum ON cp.product_type IN ('Commander Deck Set', 'Commander Deck Display')
WHERE b.expected_value IS NOT NULL
ORDER BY b.ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON v_ev_with_best_offers TO anon, authenticated;

-- ============================================================
-- STEP 7: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 8: Verify
-- ============================================================
SELECT 'Commander deck canonical products' AS metric, count(*)::text AS value
FROM canonical_products
WHERE product_type NOT IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition', 'Commander Deck Case')
  AND set_name IN (SELECT set_name FROM commander_deck_sets)
UNION ALL
SELECT 'Commander deck BotBox mappings', count(*)::text
FROM botbox_product_mappings bpm
JOIN canonical_products cp ON cp.id = bpm.canonical_product_id
WHERE cp.product_type NOT IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition', 'Commander Deck Case')
  AND cp.set_name IN (SELECT set_name FROM commander_deck_sets)
UNION ALL
SELECT 'Commander deck marketplace offers matched', count(*)::text
FROM offers
WHERE product_type NOT IN ('Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition', 'Commander Deck Case')
  AND set_name IN (SELECT set_name FROM commander_deck_sets)
  AND canonical_product_id IS NOT NULL
  AND is_sealed = true;

-- Show Doctor Who EV entries with their matched best prices
-- For Commander Deck Set, best_marketplace should show "Individual Decks"
-- if no direct set offer exists, with best_total = sum of individual deck prices
SELECT
  cp.set_name,
  cp.product_type,
  b.product_name AS botbox_name,
  b.expected_value,
  ev.best_marketplace,
  ev.best_total,
  ev.best_url
FROM canonical_products cp
JOIN botbox_product_mappings bpm ON bpm.canonical_product_id = cp.id
JOIN botbox_ev_calculations b ON b.set_code = bpm.set_code AND b.product_name = bpm.product_name
LEFT JOIN v_ev_with_best_offers ev ON ev.canonical_product_id = cp.id AND ev.set_code = b.set_code
WHERE cp.set_name = 'Doctor Who'
ORDER BY cp.product_type;
