-- Migration 007a: Backfill known_sets from BotBox and re-map
-- Run in Supabase SQL Editor AFTER 007_universal_product_matching.sql
--
-- Problem: BotBox has EV data for hundreds of sets, but known_sets only had
-- ~30 sets from marketplace scrapers. This caused most BotBox entries to be
-- unmapped because canonical_products requires set_name IN known_sets.
--
-- Fix: Insert all BotBox set names into known_sets, then re-run the
-- canonical product population and BotBox mapping steps.

-- ============================================================
-- STEP 1: Insert all BotBox set names into known_sets
-- Strip the parenthesized code from BotBox set_name
-- e.g., "Adventures in the Forgotten Realms (AFR)" -> "Adventures in the Forgotten Realms"
-- ============================================================
INSERT INTO known_sets (set_name, set_type)
SELECT DISTINCT
  trim(regexp_replace(set_name, '\s*\([A-Z0-9]+\)\s*$', '')) AS clean_name,
  'expansion' -- Default type; will be correct for most sets
FROM botbox_ev_calculations
WHERE set_name IS NOT NULL
  AND trim(regexp_replace(set_name, '\s*\([A-Z0-9]+\)\s*$', '')) != ''
ON CONFLICT (set_name) DO NOTHING;

-- ============================================================
-- STEP 2: Create canonical_products for all BotBox product types
-- Now that known_sets has all sets, we can create canonical products
-- by extracting the product type from BotBox product_name
-- ============================================================

-- First, populate from BotBox data directly using detect_product_type()
INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT
  ks.set_name,
  pt.product_type,
  ks.set_type
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
CROSS JOIN LATERAL (
  SELECT detect_product_type(b.product_name) AS product_type
) pt
WHERE pt.product_type IS NOT NULL
ON CONFLICT (set_name, product_type) DO NOTHING;

-- Also create canonical products for BotBox entries that detect_product_type() misses
-- by using the full product_name as-is (for niche products like "MTGO Redemption", etc.)
-- We'll use a simplified extraction: strip the set name prefix from product_name
INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT
  ks.set_name,
  -- Extract product type by removing set name prefix from product_name
  trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')), '([().+*?^${}|[\]\\])', '\\\1', 'g') || '\s*',
    '',
    'i'
  )) AS product_type,
  ks.set_type
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
WHERE b.product_name IS NOT NULL
  AND trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')), '([().+*?^${}|[\]\\])', '\\\1', 'g') || '\s*',
    '',
    'i'
  )) != ''
  -- Only insert if not already matched via detect_product_type
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
ON CONFLICT (set_name, product_type) DO NOTHING;

-- ============================================================
-- STEP 3: Re-run BotBox mapping with the expanded canonical_products
-- ============================================================
INSERT INTO botbox_product_mappings (canonical_product_id, set_code, product_name)
SELECT DISTINCT ON (b.set_code, b.product_name)
  cp.id,
  b.set_code,
  b.product_name
FROM botbox_ev_calculations b
JOIN canonical_products cp ON (
  -- Match set name (strip parenthesized code)
  lower(cp.set_name) = lower(trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')))
  -- Match product type: BotBox product_name contains the canonical product_type
  AND lower(b.product_name) LIKE '%' || lower(cp.product_type) || '%'
)
WHERE b.set_code IS NOT NULL
  AND b.product_name IS NOT NULL
  -- Skip already mapped
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
ORDER BY b.set_code, b.product_name, length(cp.product_type) DESC
ON CONFLICT (set_code, product_name) DO NOTHING;

-- ============================================================
-- STEP 4: For still-unmapped BotBox entries, create 1:1 mappings
-- using the extracted product type as the canonical product_type
-- ============================================================
INSERT INTO botbox_product_mappings (canonical_product_id, set_code, product_name)
SELECT
  cp.id,
  b.set_code,
  b.product_name
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
JOIN canonical_products cp ON (
  cp.set_name = ks.set_name
  AND cp.product_type = trim(regexp_replace(
    b.product_name,
    '^' || regexp_replace(ks.set_name, '([().+*?^${}|[\]\\])', '\\\1', 'g') || '\s*',
    '',
    'i'
  ))
)
WHERE b.set_code IS NOT NULL
  AND b.product_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
ON CONFLICT (set_code, product_name) DO NOTHING;

-- ============================================================
-- STEP 5: Verify results
-- ============================================================
SELECT 'Known sets (total)' AS metric, count(*)::text AS value FROM known_sets
UNION ALL
SELECT 'Canonical products (total)', count(*)::text FROM canonical_products
UNION ALL
SELECT 'BotBox mappings (total)', count(*)::text FROM botbox_product_mappings
UNION ALL
SELECT 'BotBox entries with EV', count(*)::text FROM botbox_ev_calculations WHERE expected_value IS NOT NULL
UNION ALL
SELECT 'Still unmapped BotBox (with EV)', count(*)::text
FROM botbox_ev_calculations b
WHERE b.expected_value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  );

-- Show remaining unmapped (should be very few)
SELECT set_code, set_name, product_name
FROM botbox_ev_calculations b
WHERE b.expected_value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
ORDER BY set_name, product_name
LIMIT 30;
