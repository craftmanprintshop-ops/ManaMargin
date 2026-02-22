-- Migration 007: Universal Product Matching
-- Run in Supabase SQL Editor
--
-- Creates a canonical product registry that all data sources map to.
-- Replaces frontend fuzzy matching with database JOINs.
--
-- Tables created:
--   canonical_products          - One row per unique set + product type combo
--   botbox_product_mappings     - Maps BotBox product names to canonical products
--   mtgstocks_product_mappings  - Maps MTGStocks products to canonical products
--
-- Also:
--   Adds canonical_product_id column to offers table
--   Updates classify_offer() trigger to auto-link offers
--   Creates unified views for frontend queries

-- ============================================================
-- STEP 1: Create canonical_products table
-- ============================================================
CREATE TABLE IF NOT EXISTS canonical_products (
  id BIGSERIAL PRIMARY KEY,
  set_name TEXT NOT NULL REFERENCES known_sets(set_name) ON UPDATE CASCADE,
  product_type TEXT NOT NULL,
  set_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_canonical_product UNIQUE (set_name, product_type)
);

CREATE INDEX IF NOT EXISTS idx_canonical_products_set ON canonical_products(set_name);
CREATE INDEX IF NOT EXISTS idx_canonical_products_type ON canonical_products(product_type);

-- RLS
ALTER TABLE canonical_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON canonical_products FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert" ON canonical_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update" ON canonical_products FOR UPDATE USING (true);

-- ============================================================
-- STEP 2: Create source mapping tables
-- ============================================================

-- BotBox -> canonical
CREATE TABLE IF NOT EXISTS botbox_product_mappings (
  canonical_product_id BIGINT NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  set_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  manual_override BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_botbox_mapping UNIQUE (set_code, product_name)
);

CREATE INDEX IF NOT EXISTS idx_botbox_mapping_canonical ON botbox_product_mappings(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_botbox_mapping_lookup ON botbox_product_mappings(set_code, product_name);

ALTER TABLE botbox_product_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON botbox_product_mappings FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert" ON botbox_product_mappings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update" ON botbox_product_mappings FOR UPDATE USING (true);

-- MTGStocks -> canonical
CREATE TABLE IF NOT EXISTS mtgstocks_product_mappings (
  canonical_product_id BIGINT NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  mtgstocks_id INTEGER NOT NULL,
  set_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  manual_override BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_mtgstocks_mapping UNIQUE (mtgstocks_id)
);

CREATE INDEX IF NOT EXISTS idx_mtgstocks_mapping_canonical ON mtgstocks_product_mappings(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_mtgstocks_mapping_lookup ON mtgstocks_product_mappings(set_name, product_name);

ALTER TABLE mtgstocks_product_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access" ON mtgstocks_product_mappings FOR SELECT USING (true);
CREATE POLICY "Allow service_role insert" ON mtgstocks_product_mappings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service_role update" ON mtgstocks_product_mappings FOR UPDATE USING (true);

-- ============================================================
-- STEP 3: Add canonical_product_id to offers table
-- ============================================================
ALTER TABLE offers ADD COLUMN IF NOT EXISTS canonical_product_id BIGINT
  REFERENCES canonical_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offers_canonical ON offers(canonical_product_id);

-- ============================================================
-- STEP 4: Auto-populate canonical_products from existing offers
-- ============================================================
INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT set_name, product_type, set_type
FROM offers
WHERE set_name IS NOT NULL
  AND product_type IS NOT NULL
  AND is_sealed = true
  AND set_name IN (SELECT set_name FROM known_sets)
ON CONFLICT (set_name, product_type) DO NOTHING;

-- ============================================================
-- STEP 5: Backfill offers with canonical_product_id
-- ============================================================
UPDATE offers o
SET canonical_product_id = cp.id
FROM canonical_products cp
WHERE o.set_name = cp.set_name
  AND o.product_type = cp.product_type
  AND o.canonical_product_id IS NULL;

-- ============================================================
-- STEP 6: Auto-map BotBox entries to canonical products
-- BotBox product_name contains the offers product_type
-- e.g., "Foundations Play Booster Box" contains "Booster Box"
-- ============================================================
INSERT INTO botbox_product_mappings (canonical_product_id, set_code, product_name)
SELECT DISTINCT ON (b.set_code, b.product_name)
  cp.id,
  b.set_code,
  b.product_name
FROM botbox_ev_calculations b
JOIN canonical_products cp ON (
  -- Match set: strip parenthesized code from BotBox set_name, e.g. "Foundations (FDN)" -> "Foundations"
  lower(cp.set_name) = lower(trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')))
  -- Match product: BotBox product_name contains the canonical product_type
  AND lower(b.product_name) LIKE '%' || lower(cp.product_type) || '%'
)
WHERE b.set_code IS NOT NULL
  AND b.product_name IS NOT NULL
ORDER BY b.set_code, b.product_name, length(cp.product_type) DESC
ON CONFLICT (set_code, product_name) DO NOTHING;

-- ============================================================
-- STEP 7: Auto-map MTGStocks entries to canonical products
-- Uses the normalized_product_type from v_mtgstocks_sealed_for_compare
-- ============================================================
INSERT INTO mtgstocks_product_mappings (canonical_product_id, mtgstocks_id, set_name, product_name)
SELECT DISTINCT ON (m.mtgstocks_id)
  cp.id,
  m.mtgstocks_id,
  m.set_name,
  m.product_name
FROM v_mtgstocks_sealed_for_compare m
JOIN canonical_products cp ON (
  lower(cp.set_name) = lower(m.set_name)
  AND (
    -- Direct match
    lower(m.normalized_product_type) = lower(cp.product_type)
    -- MTGStocks "Play Booster Box" -> offers "Booster Box"
    OR (m.normalized_product_type = 'Play Booster Box' AND cp.product_type = 'Booster Box')
    -- MTGStocks "Play Booster Pack" -> offers "Booster Pack"
    OR (m.normalized_product_type = 'Play Booster Pack' AND cp.product_type = 'Booster Pack')
    -- MTGStocks "Set Booster Box" -> offers "Booster Box" (for older sets)
    OR (m.normalized_product_type = 'Set Booster Box' AND cp.product_type = 'Booster Box')
  )
)
WHERE m.mtgstocks_id IS NOT NULL
ORDER BY m.mtgstocks_id, length(cp.product_type) DESC
ON CONFLICT (mtgstocks_id) DO NOTHING;

-- ============================================================
-- STEP 8: Update classify_offer() trigger to set canonical_product_id
-- ============================================================
CREATE OR REPLACE FUNCTION classify_offer()
RETURNS TRIGGER AS $$
DECLARE
  t text := COALESCE(NEW.title, '');
  t_lower text;
  t_norm text;
  matched_set text := NULL;
  matched_type text := NULL;
  remainder text;
  r record;
  sc_code text;
  canonical_id BIGINT;
BEGIN
  -- Skip if already fully classified
  IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL THEN
    -- Still link to canonical product if not yet linked
    IF NEW.canonical_product_id IS NULL THEN
      SELECT id INTO canonical_id FROM canonical_products
      WHERE set_name = NEW.set_name AND product_type = NEW.product_type;
      IF canonical_id IS NOT NULL THEN
        NEW.canonical_product_id := canonical_id;
      ELSE
        -- Auto-create canonical product if set exists in known_sets
        INSERT INTO canonical_products (set_name, product_type, set_type)
        SELECT NEW.set_name, NEW.product_type, NEW.set_type
        WHERE EXISTS (SELECT 1 FROM known_sets WHERE set_name = NEW.set_name)
        ON CONFLICT (set_name, product_type) DO UPDATE SET set_type = COALESCE(canonical_products.set_type, EXCLUDED.set_type)
        RETURNING id INTO canonical_id;
        NEW.canonical_product_id := canonical_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  t_lower := lower(t);

  -- === JUNK DETECTION ===
  IF t = '' OR t = 'null' OR t_lower LIKE 'filter:%' OR t_lower LIKE 'sort by:%' THEN
    NEW.is_sealed := false;
    RETURN NEW;
  END IF;

  -- === SINGLES DETECTION ===
  IF t ~ '\([A-Z]{2,5}-\d{2,4}\)' OR t ~ '\((LP|NM|MP|HP|DMG)\)'
     OR t_lower LIKE '%(extended art)%' OR t_lower LIKE '%(borderless)%'
     OR t_lower LIKE '%(showcase)%' OR t_lower LIKE '%(retro frame)%'
     OR t_lower LIKE '%(full art)%' THEN
    NEW.is_sealed := false;
    RETURN NEW;
  END IF;

  -- === ACCESSORIES DETECTION ===
  IF t_lower LIKE '%sleeve%' OR t_lower LIKE '%playmat%' OR t_lower LIKE '%deck box%'
     OR t_lower LIKE '%binder%' OR t_lower LIKE '%collector case%'
     OR t_lower LIKE '%mystery pin%' OR t_lower LIKE '%warhammer 40k%'
     OR t_lower LIKE '%box topper%' OR t_lower LIKE '%token set%'
     OR t_lower LIKE '%token divider%' OR t_lower LIKE '%erasable token%'
     OR t_lower LIKE '%relic token%' OR t_lower LIKE '%phunny plush%'
     OR t_lower LIKE '%land station%' OR t_lower LIKE '%dragon shield%'
     OR t_lower LIKE '%ultra pro%' OR t_lower LIKE '%ultimate guard%'
     OR t_lower LIKE '%mox emerald%' OR t_lower LIKE '%planechase set of%'
     OR t_lower LIKE '%magiccon%' THEN
    NEW.is_sealed := false;
    RETURN NEW;
  END IF;

  -- === FF_ SKU NORMALIZATION ===
  IF t LIKE 'FF_%' THEN
    t_norm := replace(substring(t from 4), '_', ' ');
    -- Match against known sets (longest first)
    FOR r IN SELECT ks.set_name, ks.set_type FROM known_sets ks
             ORDER BY length(ks.set_name) DESC LOOP
      IF lower(t_norm) LIKE lower(r.set_name) || '%' THEN
        matched_set := r.set_name;
        matched_type := r.set_type;
        remainder := trim(substring(t_norm from length(r.set_name) + 1));
        EXIT;
      END IF;
    END LOOP;
    -- Try aliases
    IF matched_set IS NULL THEN
      FOR r IN SELECT ks.set_name, ks.set_type, a as alias
               FROM known_sets ks, unnest(ks.aliases) a
               ORDER BY length(a) DESC LOOP
        IF lower(t_norm) LIKE lower(r.alias) || '%' THEN
          matched_set := r.set_name;
          matched_type := r.set_type;
          remainder := trim(substring(t_norm from length(r.alias) + 1));
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF matched_set IS NOT NULL THEN
      IF NEW.set_name IS NULL THEN NEW.set_name := matched_set; END IF;
      IF NEW.set_type IS NULL THEN NEW.set_type := matched_type; END IF;
    END IF;
    IF NEW.product_type IS NULL THEN
      NEW.product_type := detect_product_type(COALESCE(remainder, t_norm));
    END IF;
    IF NEW.product_type IS NULL AND matched_set IS NULL THEN
      NEW.is_sealed := false;
    END IF;

    -- Link to canonical product
    IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL THEN
      INSERT INTO canonical_products (set_name, product_type, set_type)
      SELECT NEW.set_name, NEW.product_type, NEW.set_type
      WHERE EXISTS (SELECT 1 FROM known_sets WHERE set_name = NEW.set_name)
      ON CONFLICT (set_name, product_type) DO UPDATE SET set_type = COALESCE(canonical_products.set_type, EXCLUDED.set_type)
      RETURNING id INTO canonical_id;
      NEW.canonical_product_id := canonical_id;
    END IF;

    RETURN NEW;
  END IF;

  -- === SC_ SKU HANDLING ===
  IF t LIKE 'SC_%' THEN
    -- Decode product type from SKU suffixes
    IF NEW.product_type IS NULL THEN
      IF t LIKE '%_CDC%' OR t LIKE '%_CE_CD_%' THEN
        NEW.product_type := 'Commander Deck Set';
      ELSIF (t LIKE '%_CD_%' OR t LIKE '%_CD') AND t NOT LIKE '%_CDC%' AND t NOT LIKE '%_CE_CD_%' THEN
        NEW.product_type := 'Commander Deck';
      ELSIF t LIKE '%_CB' OR t LIKE '%_CB_%' OR t LIKE '%_CBD%' THEN
        NEW.product_type := 'Collector Booster Display';
      ELSIF (t LIKE '%_PB' OR t LIKE '%_PB_%') AND t NOT LIKE '%_PZB%' THEN
        NEW.product_type := 'Play Booster Display';
      ELSIF t LIKE '%_DB' OR t LIKE '%_DB_%' THEN
        NEW.product_type := 'Booster Box';
      ELSIF t LIKE '%_BNDL%' OR t LIKE '%_PZB%' THEN
        NEW.product_type := 'Bundle';
      ELSIF t LIKE '%_PREPACK%' OR t LIKE '%_PRPACK%' OR t LIKE '%_PP' THEN
        NEW.product_type := 'Pre Release Pack';
      ELSIF t LIKE '%_JBD%' OR t_lower LIKE '%jumpstartboosterdisplay%' THEN
        NEW.product_type := 'Jumpstart Booster Display';
      ELSIF t LIKE '%_SBD_%' OR t LIKE '%_SCENE%' THEN
        NEW.product_type := 'Scene Box';
      ELSIF t LIKE '%_SKC_%' THEN
        NEW.product_type := 'Starter Kit';
      ELSIF t LIKE '%_TD_%' OR t LIKE '%PRECONDCK%' OR t LIKE '%PRECON_DECK%' THEN
        NEW.product_type := 'Theme Deck';
      ELSIF t LIKE '%_DN%' THEN
        NEW.product_type := 'Draft Night Kit';
      ELSIF t LIKE '%_TB_%' THEN
        NEW.product_type := 'Theme Deck';
      ELSE
        NEW.is_sealed := false;
        RETURN NEW;
      END IF;
    END IF;

    -- Decode set name from SC_ code
    IF NEW.set_name IS NULL THEN
      IF t LIKE 'SC_MTGAIB%' THEN
        sc_code := 'MTGAIB';
      ELSIF t LIKE 'SC_MTG_CCG_%' THEN
        sc_code := (regexp_match(t, '^SC_MTG_(CCG_[A-Z]+)'))[1];
      ELSIF t LIKE 'SC_MTG_RT_%' THEN
        sc_code := (regexp_match(t, '^SC_MTG_(RT_[A-Z]+)'))[1];
      ELSIF t LIKE 'SC_MTG_%' THEN
        sc_code := (regexp_match(t, '^SC_MTG_([A-Z0-9]+)'))[1];
      ELSIF t LIKE 'SC_BBG_%' THEN
        sc_code := 'BBG';
      ELSIF t LIKE 'SC_WOC%' THEN
        sc_code := NULL;
      ELSE
        sc_code := NULL;
      END IF;

      IF sc_code IS NOT NULL THEN
        SELECT ssc.set_name INTO matched_set FROM sc_set_codes ssc WHERE ssc.code = sc_code;
        IF matched_set IS NOT NULL THEN
          NEW.set_name := matched_set;
          SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
          NEW.set_type := matched_type;
        END IF;
      END IF;
    END IF;

    -- Link to canonical product
    IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL THEN
      INSERT INTO canonical_products (set_name, product_type, set_type)
      SELECT NEW.set_name, NEW.product_type, NEW.set_type
      WHERE EXISTS (SELECT 1 FROM known_sets WHERE set_name = NEW.set_name)
      ON CONFLICT (set_name, product_type) DO UPDATE SET set_type = COALESCE(canonical_products.set_type, EXCLUDED.set_type)
      RETURNING id INTO canonical_id;
      NEW.canonical_product_id := canonical_id;
    END IF;

    RETURN NEW;
  END IF;

  -- === STANDARD TITLE MATCHING ===
  t_norm := t;
  t_norm := regexp_replace(t_norm, '^Magic:?\s*[Tt]he Gathering\s*[-:]*\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '^\s*MTG\s*[-:]\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '^Universes Beyond\s*[:]*\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(PREORDER\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Presell\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Bulk Discounts\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Sealed Case\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Magic:\s*The Gathering\)\s*$', '', 'i');
  t_norm := trim(t_norm);
  t_lower := lower(t_norm);

  -- Fuzzy match against known set names (longest first)
  IF matched_set IS NULL THEN
    FOR r IN SELECT ks.set_name, ks.set_type FROM known_sets ks
             ORDER BY length(ks.set_name) DESC LOOP
      IF t_lower LIKE lower(r.set_name) || ' -%'
         OR t_lower LIKE lower(r.set_name) || ':%'
         OR t_lower = lower(r.set_name)
         OR t_lower LIKE lower(r.set_name) || ' commander%'
         OR t_lower LIKE lower(r.set_name) || ' play%'
         OR t_lower LIKE lower(r.set_name) || ' collector%'
         OR t_lower LIKE lower(r.set_name) || ' booster%'
         OR t_lower LIKE lower(r.set_name) || ' bundle%'
         OR t_lower LIKE lower(r.set_name) || ' prerelease%'
         OR t_lower LIKE lower(r.set_name) || ' draft%'
         OR t_lower LIKE lower(r.set_name) || ' scene%'
         OR t_lower LIKE lower(r.set_name) || ' theme%'
         OR t_lower LIKE lower(r.set_name) || ' starter%'
         OR t_lower LIKE lower(r.set_name) || ' jumpstart%'
         OR t_lower LIKE lower(r.set_name) || ' pizza%'
         OR t_lower LIKE lower(r.set_name) || ' turtle%'
         OR t_lower LIKE lower(r.set_name) || ' individual%'
         OR t_lower LIKE lower(r.set_name) || ' set booster%'
         OR t_lower LIKE lower(r.set_name) || ' beyond booster%'
         OR t_lower LIKE lower(r.set_name) || ' finish%'
         OR t_lower LIKE lower(r.set_name) || ' chocobo%'
         OR t_lower LIKE lower(r.set_name) || ' chocobox%'
         OR t_lower LIKE lower(r.set_name) || ' gift%'
         OR t_lower LIKE lower(r.set_name) || ' omega%'
         OR t_lower LIKE lower(r.set_name) || ' special%'
         OR t_lower LIKE lower(r.set_name) || ' holiday%'
         OR t_lower LIKE lower(r.set_name) || ' video%'
         OR t_lower LIKE lower(r.set_name) || ' ffvi%'
         OR t_lower LIKE lower(r.set_name) || ' ffvii%'
         OR t_lower LIKE lower(r.set_name) || ' ffx%'
         OR t_lower LIKE lower(r.set_name) || ' ffxiv%'
         OR t_lower LIKE lower(r.set_name) || ' sleeved%'
         OR t_lower LIKE lower(r.set_name) || ' learn%'
         OR t_lower LIKE lower(r.set_name) || ' beginner%'
         OR t_lower LIKE lower(r.set_name) || ' 60-card%' THEN
        matched_set := r.set_name;
        matched_type := r.set_type;
        remainder := trim(substring(t_norm from length(r.set_name) + 1));
        remainder := regexp_replace(remainder, '^\s*[-:]\s*', '');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Try aliases if no direct match
  IF matched_set IS NULL THEN
    FOR r IN SELECT ks.set_name, ks.set_type, a as alias
             FROM known_sets ks, unnest(ks.aliases) a
             ORDER BY length(a) DESC LOOP
      IF t_lower LIKE lower(r.alias) || ' -%'
         OR t_lower LIKE lower(r.alias) || ':%'
         OR t_lower = lower(r.alias)
         OR t_lower LIKE lower(r.alias) || ' %' THEN
        matched_set := r.set_name;
        matched_type := r.set_type;
        remainder := trim(substring(t_norm from length(r.alias) + 1));
        remainder := regexp_replace(remainder, '^\s*[-:]\s*', '');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- Apply matched set
  IF matched_set IS NOT NULL THEN
    IF NEW.set_name IS NULL THEN NEW.set_name := matched_set; END IF;
    IF NEW.set_type IS NULL THEN NEW.set_type := matched_type; END IF;
  END IF;

  -- Detect product type from remainder
  IF NEW.product_type IS NULL THEN
    NEW.product_type := detect_product_type(COALESCE(remainder, t_norm));
  END IF;

  -- If set not matched yet, try deck-name->set mapping for individual commander decks
  IF NEW.set_name IS NULL AND NEW.product_type = 'Commander Deck' THEN
    SELECT cds.set_name INTO matched_set
    FROM commander_deck_sets cds
    WHERE t_lower LIKE '%' || cds.deck_name || '%'
    ORDER BY length(cds.deck_name) DESC
    LIMIT 1;
    IF matched_set IS NOT NULL THEN
      NEW.set_name := matched_set;
      SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
      NEW.set_type := matched_type;
    END IF;
  END IF;

  -- Secret Lair
  IF NEW.set_name IS NULL AND (NEW.product_type = 'Secret Lair' OR t_lower LIKE '%secret lair%') THEN
    NEW.set_name := 'Secret Lair';
    NEW.set_type := 'secret_lair';
    IF NEW.product_type IS NULL THEN NEW.product_type := 'Secret Lair'; END IF;
  END IF;

  -- If still no set or product type, mark non-sealed
  IF NEW.set_name IS NULL AND NEW.product_type IS NULL THEN
    NEW.is_sealed := false;
  END IF;

  -- Link to canonical product
  IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL AND NEW.canonical_product_id IS NULL THEN
    INSERT INTO canonical_products (set_name, product_type, set_type)
    SELECT NEW.set_name, NEW.product_type, NEW.set_type
    WHERE EXISTS (SELECT 1 FROM known_sets WHERE set_name = NEW.set_name)
    ON CONFLICT (set_name, product_type) DO UPDATE SET set_type = COALESCE(canonical_products.set_type, EXCLUDED.set_type)
    RETURNING id INTO canonical_id;
    NEW.canonical_product_id := canonical_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 9: Create unified view for EV Calculations page
-- Replaces frontend fuzzy matching in EVCalculations.tsx
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
  -- Best in-stock offer
  best.marketplace AS best_marketplace,
  best.price AS best_price,
  best.shipping AS best_shipping,
  (best.price + COALESCE(best.shipping, 0)) AS best_total,
  best.url AS best_url
FROM botbox_ev_calculations b
JOIN botbox_product_mappings bpm ON (
  bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
)
JOIN canonical_products cp ON cp.id = bpm.canonical_product_id
LEFT JOIN LATERAL (
  SELECT o.marketplace, o.price, o.shipping, o.url
  FROM offers o
  WHERE o.canonical_product_id = cp.id
    AND o.in_stock = true
    AND o.is_sealed = true
  ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
  LIMIT 1
) best ON true
WHERE b.expected_value IS NOT NULL
ORDER BY b.ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON v_ev_with_best_offers TO anon, authenticated;

-- ============================================================
-- STEP 10: Create view for unmapped products (for review)
-- ============================================================
CREATE OR REPLACE VIEW v_unmapped_products AS
SELECT
  'BotBox' AS source,
  b.set_code,
  b.set_name,
  b.product_name,
  b.expected_value
FROM botbox_ev_calculations b
WHERE NOT EXISTS (
  SELECT 1 FROM botbox_product_mappings bpm
  WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
)
AND b.expected_value IS NOT NULL

UNION ALL

SELECT
  'MTGStocks' AS source,
  NULL AS set_code,
  m.set_name,
  m.product_name,
  m.market_price AS expected_value
FROM v_mtgstocks_sealed_latest m
WHERE NOT EXISTS (
  SELECT 1 FROM mtgstocks_product_mappings mpm
  WHERE mpm.mtgstocks_id = m.mtgstocks_id
);

GRANT SELECT ON v_unmapped_products TO anon, authenticated;

-- ============================================================
-- STEP 11: Refresh materialized view
-- ============================================================
-- Note: offers_latest_enriched_mv may need to include canonical_product_id
-- For now, the existing MV continues to work. The new views query offers directly.

-- ============================================================
-- STEP 12: Verify results
-- ============================================================
SELECT 'Canonical products' AS metric, count(*)::text AS value FROM canonical_products
UNION ALL
SELECT 'BotBox mappings', count(*)::text FROM botbox_product_mappings
UNION ALL
SELECT 'MTGStocks mappings', count(*)::text FROM mtgstocks_product_mappings
UNION ALL
SELECT 'Offers linked', count(*)::text FROM offers WHERE canonical_product_id IS NOT NULL
UNION ALL
SELECT 'Offers not linked (sealed)', count(*)::text FROM offers WHERE canonical_product_id IS NULL AND is_sealed = true
UNION ALL
SELECT 'Unmapped BotBox (with EV)', count(*)::text
FROM botbox_ev_calculations b
WHERE b.expected_value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
UNION ALL
SELECT 'Unmapped MTGStocks', count(*)::text
FROM v_mtgstocks_sealed_latest m
WHERE NOT EXISTS (
  SELECT 1 FROM mtgstocks_product_mappings mpm
  WHERE mpm.mtgstocks_id = m.mtgstocks_id
);

-- Show unmapped BotBox entries for review
SELECT 'UNMAPPED BOTBOX:' AS info, set_code, set_name, product_name
FROM botbox_ev_calculations b
WHERE b.expected_value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM botbox_product_mappings bpm
    WHERE bpm.set_code = b.set_code AND bpm.product_name = b.product_name
  )
ORDER BY set_name, product_name
LIMIT 30;
