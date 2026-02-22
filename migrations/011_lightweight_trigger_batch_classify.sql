-- Migration 011: Lightweight Trigger + Batch Classification
-- Run in Supabase SQL Editor AFTER 010
--
-- Problem:
--   classify_offer() trigger loops over ALL known_sets (80+) for EVERY INSERT,
--   causing timeouts when scraping. The n8n workflow times out at 300s.
--
-- Solution:
--   1) Add a `classified` column to offers
--   2) Replace the heavy trigger with a lightweight version that only does:
--      - Junk/singles/accessories detection (cheap string checks)
--      - SC_ SKU product type detection (fixed patterns, no DB lookups)
--      - FF_ SKU basic normalization
--      - Sets classified = false for anything needing full classification
--   3) Create classify_pending_offers() function for batch processing
--   4) Add a server endpoint / Supabase cron to run batch classification

-- ============================================================
-- STEP 1: Add classified column to offers
-- ============================================================
ALTER TABLE offers ADD COLUMN IF NOT EXISTS classified BOOLEAN DEFAULT true;

-- Mark all existing offers as classified (they already went through the old trigger)
UPDATE offers SET classified = true WHERE classified IS NULL;

-- Set default for new inserts to false (trigger will handle it)
ALTER TABLE offers ALTER COLUMN classified SET DEFAULT false;

-- Index for finding unclassified offers quickly
CREATE INDEX IF NOT EXISTS idx_offers_unclassified
  ON offers (classified) WHERE classified = false;

-- ============================================================
-- STEP 2: Replace classify_offer() with lightweight version
-- ============================================================
CREATE OR REPLACE FUNCTION classify_offer()
RETURNS TRIGGER AS $$
DECLARE
  t text := COALESCE(NEW.title, '');
  t_lower text;
  sc_code text;
BEGIN
  -- Always start as unclassified
  NEW.classified := false;

  -- Skip if already fully classified (e.g., manual insert with set_name + product_type)
  IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL THEN
    NEW.classified := true;

    -- Auto-create canonical product and link
    IF NEW.is_sealed = true THEN
      INSERT INTO canonical_products (set_name, product_type, set_type)
      VALUES (NEW.set_name, NEW.product_type, NEW.set_type)
      ON CONFLICT (set_name, product_type) DO NOTHING;

      SELECT id INTO NEW.canonical_product_id
      FROM canonical_products
      WHERE set_name = NEW.set_name AND product_type = NEW.product_type;
    END IF;

    RETURN NEW;
  END IF;

  t_lower := lower(t);

  -- === JUNK DETECTION (cheap string checks) ===
  IF t = '' OR t = 'null' OR t_lower LIKE 'filter:%' OR t_lower LIKE 'sort by:%' THEN
    NEW.is_sealed := false;
    NEW.classified := true;  -- No further processing needed
    RETURN NEW;
  END IF;

  -- === SINGLES DETECTION (cheap regex) ===
  IF t ~ '\([A-Z]{2,5}-\d{2,4}\)' OR t ~ '\((LP|NM|MP|HP|DMG)\)'
     OR t_lower LIKE '%(extended art)%' OR t_lower LIKE '%(borderless)%'
     OR t_lower LIKE '%(showcase)%' OR t_lower LIKE '%(retro frame)%'
     OR t_lower LIKE '%(full art)%' THEN
    NEW.is_sealed := false;
    NEW.classified := true;
    RETURN NEW;
  END IF;

  -- === ACCESSORIES DETECTION (cheap LIKE checks) ===
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
    NEW.classified := true;
    RETURN NEW;
  END IF;

  -- === SC_ SKU: detect product type from fixed patterns (no DB lookup) ===
  IF t LIKE 'SC_%' THEN
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
        NEW.classified := true;
        RETURN NEW;
      END IF;
    END IF;
    -- SC_ SKU: set_name requires DB lookup -> leave classified = false
    RETURN NEW;
  END IF;

  -- Everything else (FF_ SKUs, standard titles) needs full classification
  -- Leave classified = false, batch process will handle it
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 3: Create batch classification function
-- ============================================================
CREATE OR REPLACE FUNCTION classify_pending_offers(batch_limit INTEGER DEFAULT 1000)
RETURNS TABLE(total_processed INTEGER, total_classified INTEGER, total_skipped INTEGER) AS $$
DECLARE
  r RECORD;
  t text;
  t_lower text;
  t_norm text;
  matched_set text;
  matched_type text;
  remainder text;
  ks_row RECORD;
  sc_code text;
  processed INTEGER := 0;
  classified_count INTEGER := 0;
  skipped INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, title, set_name, product_type, set_type, is_sealed, canonical_product_id
    FROM offers
    WHERE classified = false
    ORDER BY fetched_at DESC
    LIMIT batch_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    processed := processed + 1;
    t := COALESCE(r.title, '');
    t_lower := lower(t);
    matched_set := r.set_name;
    matched_type := r.set_type;

    -- === FF_ SKU NORMALIZATION ===
    IF t LIKE 'FF_%' THEN
      t_norm := replace(substring(t from 4), '_', ' ');

      IF matched_set IS NULL THEN
        FOR ks_row IN SELECT ks.set_name, ks.set_type FROM known_sets ks
                     ORDER BY length(ks.set_name) DESC LOOP
          IF lower(t_norm) LIKE lower(ks_row.set_name) || '%' THEN
            matched_set := ks_row.set_name;
            matched_type := ks_row.set_type;
            remainder := trim(substring(t_norm from length(ks_row.set_name) + 1));
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF matched_set IS NULL THEN
        FOR ks_row IN SELECT ks.set_name, ks.set_type, a as alias
                     FROM known_sets ks, unnest(ks.aliases) a
                     ORDER BY length(a) DESC LOOP
          IF lower(t_norm) LIKE lower(ks_row.alias) || '%' THEN
            matched_set := ks_row.set_name;
            matched_type := ks_row.set_type;
            remainder := trim(substring(t_norm from length(ks_row.alias) + 1));
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF r.product_type IS NULL THEN
        r.product_type := detect_product_type(COALESCE(remainder, t_norm));
      END IF;

      IF r.product_type IS NULL AND matched_set IS NULL THEN
        UPDATE offers SET is_sealed = false, classified = true WHERE id = r.id;
        skipped := skipped + 1;
        CONTINUE;
      END IF;

    -- === SC_ SKU: set_name lookup ===
    ELSIF t LIKE 'SC_%' THEN
      IF matched_set IS NULL THEN
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
            SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
          END IF;
        END IF;
      END IF;

    -- === STANDARD TITLE MATCHING ===
    ELSE
      t_norm := t;
      t_norm := regexp_replace(t_norm, '^Magic:?\s*[Tt]he Gathering\s*[-:]*\s*', '', 'i');
      t_norm := regexp_replace(t_norm, '^\s*MTG\s*[-:]\s*', '', 'i');
      t_norm := regexp_replace(t_norm, '^Universes Beyond\s*[:]*\s*', '', 'i');
      t_norm := regexp_replace(t_norm, '\s*\(PREORDER\)\s*$', '', 'i');
      t_norm := regexp_replace(t_norm, '\s*\(Presell\)\s*$', '', 'i');
      t_norm := regexp_replace(t_norm, '\s*\(Bulk Discounts\)\s*$', '', 'i');
      t_norm := regexp_replace(t_norm, '\s*\(Sealed Case\)\s*$', ' Case', 'i');
      t_norm := regexp_replace(t_norm, '\s*\(Magic:\s*The Gathering\)\s*$', '', 'i');
      t_norm := trim(t_norm);
      t_lower := lower(t_norm);

      -- Fuzzy match against known set names (longest first)
      IF matched_set IS NULL THEN
        FOR ks_row IN SELECT ks.set_name, ks.set_type FROM known_sets ks
                     ORDER BY length(ks.set_name) DESC LOOP
          IF t_lower LIKE lower(ks_row.set_name) || ' -%'
             OR t_lower LIKE lower(ks_row.set_name) || ':%'
             OR t_lower = lower(ks_row.set_name)
             OR t_lower LIKE lower(ks_row.set_name) || ' commander%'
             OR t_lower LIKE lower(ks_row.set_name) || ' play%'
             OR t_lower LIKE lower(ks_row.set_name) || ' collector%'
             OR t_lower LIKE lower(ks_row.set_name) || ' booster%'
             OR t_lower LIKE lower(ks_row.set_name) || ' bundle%'
             OR t_lower LIKE lower(ks_row.set_name) || ' prerelease%'
             OR t_lower LIKE lower(ks_row.set_name) || ' draft%'
             OR t_lower LIKE lower(ks_row.set_name) || ' scene%'
             OR t_lower LIKE lower(ks_row.set_name) || ' theme%'
             OR t_lower LIKE lower(ks_row.set_name) || ' starter%'
             OR t_lower LIKE lower(ks_row.set_name) || ' jumpstart%'
             OR t_lower LIKE lower(ks_row.set_name) || ' pizza%'
             OR t_lower LIKE lower(ks_row.set_name) || ' turtle%'
             OR t_lower LIKE lower(ks_row.set_name) || ' individual%'
             OR t_lower LIKE lower(ks_row.set_name) || ' set booster%'
             OR t_lower LIKE lower(ks_row.set_name) || ' beyond booster%'
             OR t_lower LIKE lower(ks_row.set_name) || ' finish%'
             OR t_lower LIKE lower(ks_row.set_name) || ' chocobo%'
             OR t_lower LIKE lower(ks_row.set_name) || ' chocobox%'
             OR t_lower LIKE lower(ks_row.set_name) || ' gift%'
             OR t_lower LIKE lower(ks_row.set_name) || ' omega%'
             OR t_lower LIKE lower(ks_row.set_name) || ' special%'
             OR t_lower LIKE lower(ks_row.set_name) || ' holiday%'
             OR t_lower LIKE lower(ks_row.set_name) || ' video%'
             OR t_lower LIKE lower(ks_row.set_name) || ' ffvi%'
             OR t_lower LIKE lower(ks_row.set_name) || ' ffvii%'
             OR t_lower LIKE lower(ks_row.set_name) || ' ffx%'
             OR t_lower LIKE lower(ks_row.set_name) || ' ffxiv%'
             OR t_lower LIKE lower(ks_row.set_name) || ' sleeved%'
             OR t_lower LIKE lower(ks_row.set_name) || ' learn%'
             OR t_lower LIKE lower(ks_row.set_name) || ' beginner%'
             OR t_lower LIKE lower(ks_row.set_name) || ' 60-card%' THEN
            matched_set := ks_row.set_name;
            matched_type := ks_row.set_type;
            remainder := trim(substring(t_norm from length(ks_row.set_name) + 1));
            remainder := regexp_replace(remainder, '^\s*[-:]\s*', '');
            EXIT;
          END IF;
        END LOOP;
      END IF;

      -- Try aliases if no direct match
      IF matched_set IS NULL THEN
        FOR ks_row IN SELECT ks.set_name, ks.set_type, a as alias
                     FROM known_sets ks, unnest(ks.aliases) a
                     ORDER BY length(a) DESC LOOP
          IF t_lower LIKE lower(ks_row.alias) || ' -%'
             OR t_lower LIKE lower(ks_row.alias) || ':%'
             OR t_lower = lower(ks_row.alias)
             OR t_lower LIKE lower(ks_row.alias) || ' %' THEN
            matched_set := ks_row.set_name;
            matched_type := ks_row.set_type;
            remainder := trim(substring(t_norm from length(ks_row.alias) + 1));
            remainder := regexp_replace(remainder, '^\s*[-:]\s*', '');
            EXIT;
          END IF;
        END LOOP;
      END IF;

      -- Detect product type from remainder
      IF r.product_type IS NULL THEN
        r.product_type := detect_product_type(COALESCE(remainder, t_norm));
      END IF;

      -- Commander deck -> set mapping
      IF matched_set IS NULL AND r.product_type = 'Commander Deck' THEN
        SELECT cds.set_name INTO matched_set
        FROM commander_deck_sets cds
        WHERE t_lower LIKE '%' || cds.deck_name || '%'
        ORDER BY length(cds.deck_name) DESC
        LIMIT 1;
        IF matched_set IS NOT NULL THEN
          SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
        END IF;
      END IF;

      -- Secret Lair
      IF matched_set IS NULL AND (r.product_type = 'Secret Lair' OR t_lower LIKE '%secret lair%') THEN
        matched_set := 'Secret Lair';
        matched_type := 'secret_lair';
        IF r.product_type IS NULL THEN r.product_type := 'Secret Lair'; END IF;
      END IF;
    END IF;

    -- If still no set or product type, mark non-sealed
    IF matched_set IS NULL AND r.product_type IS NULL THEN
      UPDATE offers SET is_sealed = false, classified = true WHERE id = r.id;
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    -- Auto-create canonical product and link
    DECLARE
      cp_id BIGINT := NULL;
    BEGIN
      IF matched_set IS NOT NULL AND r.product_type IS NOT NULL THEN
        INSERT INTO canonical_products (set_name, product_type, set_type)
        VALUES (matched_set, r.product_type, matched_type)
        ON CONFLICT (set_name, product_type) DO NOTHING;

        SELECT id INTO cp_id
        FROM canonical_products
        WHERE set_name = matched_set AND product_type = r.product_type;
      END IF;

      UPDATE offers SET
        set_name = COALESCE(matched_set, set_name),
        set_type = COALESCE(matched_type, set_type),
        product_type = COALESCE(r.product_type, product_type),
        canonical_product_id = COALESCE(cp_id, canonical_product_id),
        classified = true
      WHERE id = r.id;

      classified_count := classified_count + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT processed, classified_count, skipped;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 4: Create a wrapper to call from HTTP / n8n
-- ============================================================
-- This can be called via Supabase RPC: POST /rest/v1/rpc/run_batch_classification
CREATE OR REPLACE FUNCTION run_batch_classification()
RETURNS JSONB AS $$
DECLARE
  result RECORD;
  pending_count INTEGER;
BEGIN
  SELECT count(*) INTO pending_count FROM offers WHERE classified = false;

  IF pending_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'message', 'No pending offers to classify', 'pending', 0);
  END IF;

  -- Process in batches of 500 until done
  DECLARE
    total_processed INTEGER := 0;
    total_classified INTEGER := 0;
    total_skipped INTEGER := 0;
    batch_processed INTEGER;
    batch_classified INTEGER;
    batch_skipped INTEGER;
  BEGIN
    LOOP
      SELECT * INTO batch_processed, batch_classified, batch_skipped
      FROM classify_pending_offers(500);

      total_processed := total_processed + batch_processed;
      total_classified := total_classified + batch_classified;
      total_skipped := total_skipped + batch_skipped;

      -- Stop when no more unclassified offers
      EXIT WHEN batch_processed = 0;
    END LOOP;

    RETURN jsonb_build_object(
      'ok', true,
      'total_processed', total_processed,
      'total_classified', total_classified,
      'total_skipped', total_skipped
    );
  END;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to service role (for n8n RPC calls)
GRANT EXECUTE ON FUNCTION run_batch_classification() TO service_role;
GRANT EXECUTE ON FUNCTION classify_pending_offers(INTEGER) TO service_role;

-- ============================================================
-- STEP 5: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();
