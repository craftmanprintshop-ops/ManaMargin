-- Migration 010: Fix Commander Deck Offer Mappings
-- Run in Supabase SQL Editor AFTER 009
--
-- Problem: Individual commander deck marketplace offers (e.g., "Doctor Who
-- Masters of Evil" at $31.99) are still linked to the "Commander Deck Set"
-- canonical product, making the set appear to cost $31.99 instead of ~$130+.
--
-- Migration 009 only reclassified offers with product_type = 'Commander Deck'.
-- This migration also catches offers with product_type = 'Commander Deck Set'
-- or any other type that are actually individual deck listings.

-- ============================================================
-- STEP 1: Reclassify offers linked to Commander Deck Set that are
-- actually individual decks (match deck name in title)
-- ============================================================

-- Use commander_deck_sets to find individual deck names in offer titles
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
  -- Only fix offers currently linked to a Commander Deck Set canonical product
  AND o.canonical_product_id IN (
    SELECT id FROM canonical_products
    WHERE product_type IN ('Commander Deck Set', 'Commander Deck', 'Commander Deck Display')
  )
  -- Don't reclassify offers that actually ARE for the full set/display
  AND lower(o.title) NOT LIKE '%display%'
  AND lower(o.title) NOT LIKE '%set of%'
  AND lower(o.title) NOT LIKE '%all _ decks%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- Also match via canonical_products for deck names not in commander_deck_sets
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
  AND lower(o.title) NOT LIKE '%all _ decks%'
  AND lower(o.title) NOT LIKE '%complete set%';

-- ============================================================
-- STEP 2: For any remaining offers with product_type = 'Commander Deck'
-- that have a specific deck name in the title, reclassify them
-- (catches offers that weren't touched by migration 009 Step 3)
-- ============================================================

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

-- ============================================================
-- STEP 3: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 4: Verify - Show Doctor Who offers and their mappings
-- ============================================================

-- Show what canonical products Doctor Who offers are linked to
SELECT
  o.product_type,
  cp.product_type AS canonical_type,
  count(*) AS offer_count,
  min(o.price + COALESCE(o.shipping, 0)) AS min_total,
  max(o.price + COALESCE(o.shipping, 0)) AS max_total
FROM offers o
LEFT JOIN canonical_products cp ON cp.id = o.canonical_product_id
WHERE o.set_name = 'Doctor Who'
  AND o.is_sealed = true
  AND o.in_stock = true
GROUP BY o.product_type, cp.product_type
ORDER BY o.product_type;

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
