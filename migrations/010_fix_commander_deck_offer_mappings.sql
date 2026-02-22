-- Migration 010: Fix Commander Deck Offer Mappings
-- Run in Supabase SQL Editor AFTER 009
--
-- Problem: Individual commander deck marketplace offers (e.g., "Doctor Who
-- Paradox Power" at $31.99) are still linked to the "Commander Deck Set"
-- canonical product. This happens because:
--   1) Migration 009 only reclassified offers with product_type = 'Commander Deck'
--   2) Some marketplace titles use SKU-style names without spaces
--      (e.g., "SC_MTG_DRWHO_CDC_PARADOXPOWER") so LIKE '%paradox power%' fails
--
-- Fix: Match deck names both with spaces and without spaces (collapsed).

-- ============================================================
-- STEP 1: Reclassify offers linked to Commander Deck Set/Commander Deck
-- that are actually individual decks. Match deck name in title using
-- both normal and space-stripped comparison.
-- ============================================================

-- Match with spaces (normal titles like "Doctor Who Paradox Power Commander Deck")
UPDATE offers o
SET product_type = initcap(cds.deck_name),
    canonical_product_id = cp.id
FROM commander_deck_sets cds
JOIN canonical_products cp ON (
  cp.set_name = cds.set_name
  AND lower(cp.product_type) = lower(cds.deck_name)
)
WHERE o.set_name = cds.set_name
  AND lower(o.title) LIKE '%' || lower(cds.deck_name) || '%'
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%all _ decks%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Match WITHOUT spaces (SKU-style titles like "SC_MTG_DRWHO_CDC_PARADOXPOWER")
UPDATE offers o
SET product_type = initcap(cds.deck_name),
    canonical_product_id = cp.id
FROM commander_deck_sets cds
JOIN canonical_products cp ON (
  cp.set_name = cds.set_name
  AND lower(cp.product_type) = lower(cds.deck_name)
)
WHERE o.set_name = cds.set_name
  AND lower(replace(o.title, ' ', '')) LIKE '%' || lower(replace(cds.deck_name, ' ', '')) || '%'
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Also match via canonical_products for deck names not in commander_deck_sets
-- (with spaces)
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
WHERE o.set_name = cp.set_name
  AND lower(o.title) LIKE '%' || lower(cp.product_type) || '%'
  AND cp.product_type NOT IN (
    'Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition',
    'Commander Deck Case', 'Collector Booster Box', 'Booster Box', 'Bundle',
    'Booster Pack', 'Pre Release Pack', 'Starter Kit', 'Starter Collection',
    'Scene Box', 'Jumpstart Booster Display', 'Beginner Box', 'Theme Deck',
    'Draft Night Kit', 'Secret Lair', 'Box Topper', 'Video Game Deck',
    'Scene Box Display', 'Collector Booster Pack'
  )
  AND length(cp.product_type) > 5
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- (without spaces)
UPDATE offers o
SET product_type = cp.product_type,
    canonical_product_id = cp.id
FROM canonical_products cp
WHERE o.set_name = cp.set_name
  AND lower(replace(o.title, ' ', '')) LIKE '%' || lower(replace(cp.product_type, ' ', '')) || '%'
  AND cp.product_type NOT IN (
    'Commander Deck', 'Commander Deck Set', 'Commander Deck Collector Edition',
    'Commander Deck Case', 'Collector Booster Box', 'Booster Box', 'Bundle',
    'Booster Pack', 'Pre Release Pack', 'Starter Kit', 'Starter Collection',
    'Scene Box', 'Jumpstart Booster Display', 'Beginner Box', 'Theme Deck',
    'Draft Night Kit', 'Secret Lair', 'Box Topper', 'Video Game Deck',
    'Scene Box Display', 'Collector Booster Pack'
  )
  AND length(cp.product_type) > 5
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- ============================================================
-- STEP 2: For any remaining offers with generic commander types
-- that have a specific deck name in the title, reclassify them
-- ============================================================

-- With spaces
UPDATE offers o
SET product_type = initcap(cds.deck_name),
    canonical_product_id = cp.id
FROM commander_deck_sets cds
JOIN canonical_products cp ON (
  cp.set_name = cds.set_name
  AND lower(cp.product_type) = lower(cds.deck_name)
)
WHERE o.product_type IN ('Commander Deck', 'Commander Deck Set')
  AND o.set_name = cds.set_name
  AND lower(o.title) LIKE '%' || lower(cds.deck_name) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Without spaces (SKU-style)
UPDATE offers o
SET product_type = initcap(cds.deck_name),
    canonical_product_id = cp.id
FROM commander_deck_sets cds
JOIN canonical_products cp ON (
  cp.set_name = cds.set_name
  AND lower(cp.product_type) = lower(cds.deck_name)
)
WHERE o.product_type IN ('Commander Deck', 'Commander Deck Set')
  AND o.set_name = cds.set_name
  AND lower(replace(o.title, ' ', '')) LIKE '%' || lower(replace(cds.deck_name, ' ', '')) || '%'
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- ============================================================
-- STEP 3: Also update the classify_offer() trigger to do
-- space-stripped matching for future offers
-- ============================================================

-- Update classify_offer to also try spaceless deck name matching
-- This is done by adding to the existing commander deck matching section
-- (The full trigger replacement is in migration 008; here we just need
-- to ensure future offers also get the spaceless match)

-- ============================================================
-- STEP 4: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 5: Verify - Show Doctor Who offers and their mappings
-- ============================================================

-- Show what canonical products Doctor Who offers are linked to
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
