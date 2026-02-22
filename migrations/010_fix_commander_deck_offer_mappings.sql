-- Migration 010: Fix Commander Deck Offer Mappings (v3)
-- Run in Supabase SQL Editor AFTER 009
--
-- Problems found:
--   1) Canonical product_types from BotBox are "Commander Deck Paradox Power"
--      (with "Commander Deck" prefix). The deck_name in commander_deck_sets is
--      the lowercased version: "commander deck paradox power". So space-stripped
--      matching tried "commanderdeckparadoxpower" which doesn't match SKU
--      "PARADOXPOWER".
--   2) The deck_sum LATERAL in the view counts 6 products instead of 4 because
--      the exclusion list misses types like "Collector Booster Sample Pack".
--      Should use positive matching (LIKE 'Commander Deck %') instead.
--
-- Fix:
--   a) Extract the deck-specific name by stripping "Commander Deck " prefix
--   b) Match that short name in offer titles (with and without spaces)
--   c) Recreate the view with positive deck matching

-- ============================================================
-- STEP 1: Fix commander_deck_sets to store just the deck-specific name
-- (e.g., "paradox power" not "commander deck paradox power")
-- ============================================================

-- Delete the bad entries that have "commander deck" prefix
DELETE FROM commander_deck_sets
WHERE deck_name LIKE 'commander deck %'
  AND deck_name NOT IN ('commander deck', 'commander deck set', 'commander deck display');

-- Re-insert with just the deck-specific name
INSERT INTO commander_deck_sets (deck_name, set_name)
SELECT DISTINCT
  lower(regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i')),
  cp.set_name
FROM canonical_products cp
WHERE cp.product_type LIKE 'Commander Deck %'
  AND cp.product_type NOT IN (
    'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
    'Commander Deck Collector Edition'
  )
  AND length(regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i')) > 3
ON CONFLICT (deck_name) DO UPDATE SET set_name = EXCLUDED.set_name;

-- ============================================================
-- STEP 2: Reclassify offers that are individual decks but linked
-- to Commander Deck Set / Commander Deck canonical products
-- ============================================================

-- Extract the deck-specific part from canonical product_type and match in titles
-- E.g., "Commander Deck Paradox Power" → extract "Paradox Power" → match in title

-- With spaces (normal titles)
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
CROSS JOIN LATERAL (
  SELECT regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i') AS short_name
) deck
WHERE cp.product_type LIKE 'Commander Deck %'
  AND cp.product_type NOT IN (
    'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
    'Commander Deck Collector Edition'
  )
  AND length(deck.short_name) > 3
  AND o.set_name = cp.set_name
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(o.title) LIKE '%' || lower(deck.short_name) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Without spaces (SKU-style titles like "SC_MTG_DRWHO_CDC_PARADOXPOWER")
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
CROSS JOIN LATERAL (
  SELECT regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i') AS short_name
) deck
WHERE cp.product_type LIKE 'Commander Deck %'
  AND cp.product_type NOT IN (
    'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
    'Commander Deck Collector Edition'
  )
  AND length(deck.short_name) > 3
  AND o.set_name = cp.set_name
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(replace(o.title, ' ', '')) LIKE '%' || lower(replace(deck.short_name, ' ', '')) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- ============================================================
-- STEP 3: Also reclassify any remaining offers with generic
-- product_type that have a specific deck name in title
-- ============================================================

-- With spaces
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
CROSS JOIN LATERAL (
  SELECT regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i') AS short_name
) deck
WHERE cp.product_type LIKE 'Commander Deck %'
  AND cp.product_type NOT IN (
    'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
    'Commander Deck Collector Edition'
  )
  AND length(deck.short_name) > 3
  AND o.set_name = cp.set_name
  AND o.product_type IN ('Commander Deck', 'Commander Deck Set')
  AND lower(o.title) LIKE '%' || lower(deck.short_name) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Without spaces
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
CROSS JOIN LATERAL (
  SELECT regexp_replace(cp.product_type, '^Commander Deck\s+', '', 'i') AS short_name
) deck
WHERE cp.product_type LIKE 'Commander Deck %'
  AND cp.product_type NOT IN (
    'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
    'Commander Deck Collector Edition'
  )
  AND length(deck.short_name) > 3
  AND o.set_name = cp.set_name
  AND o.product_type IN ('Commander Deck', 'Commander Deck Set')
  AND lower(replace(o.title, ' ', '')) LIKE '%' || lower(replace(deck.short_name, ' ', '')) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- ============================================================
-- STEP 4: Recreate view with positive deck matching
-- instead of fragile exclusion list
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
-- Sum of individual deck best prices (only for Commander Deck Set)
-- Uses POSITIVE matching: only canonical products starting with "Commander Deck "
-- that are not generic types (Set, Case, Display, Collector Edition)
LEFT JOIN LATERAL (
  SELECT
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
    -- Positive match: must start with "Commander Deck " (individual deck names)
    AND ind_cp.product_type LIKE 'Commander Deck %'
    -- Exclude generic commander types
    AND ind_cp.product_type NOT IN (
      'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
      'Commander Deck Collector Edition'
    )
) deck_sum ON cp.product_type IN ('Commander Deck Set', 'Commander Deck Display')
WHERE b.expected_value IS NOT NULL
ORDER BY b.ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON v_ev_with_best_offers TO anon, authenticated;

-- ============================================================
-- STEP 5: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 6: Verify
-- ============================================================

-- Show Doctor Who offers and their canonical product mappings
SELECT
  o.title,
  o.product_type,
  cp.product_type AS canonical_type,
  o.price,
  o.shipping,
  (o.price + COALESCE(o.shipping, 0)) AS total
FROM offers o
LEFT JOIN canonical_products cp ON cp.id = o.canonical_product_id
WHERE o.set_name = 'Doctor Who'
  AND o.is_sealed = true
  AND o.in_stock = true
ORDER BY o.product_type, total;

-- Show the EV view results for Doctor Who
SELECT
  set_name,
  product_type,
  expected_value,
  best_marketplace,
  best_total,
  best_url,
  individual_deck_count,
  individual_decks_matched
FROM v_ev_with_best_offers
WHERE set_name = 'Doctor Who'
ORDER BY product_type;
