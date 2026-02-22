-- Migration 008: Detect "Case" as a distinct product type
-- Run in Supabase SQL Editor
--
-- Problem: detect_product_type() treats "Starter Collection Case" and
-- "Starter Collection" as the same product type. Cases contain multiple
-- units (typically 6) so their price and EV are much higher. They must
-- be separate canonical products.
--
-- Fix: Add case detection at the TOP of detect_product_type() so it fires
-- before the non-case patterns. Then re-create canonical products and
-- re-map BotBox entries for the new case types.

-- ============================================================
-- STEP 1: Update detect_product_type() with case awareness
-- ============================================================
CREATE OR REPLACE FUNCTION detect_product_type(remainder text)
RETURNS text AS $$
DECLARE
  r text := lower(COALESCE(remainder, ''));
BEGIN
  -- ======== CASE VARIANTS (check first — cases are always distinct) ========
  IF r LIKE '%collector booster%case%' OR r LIKE '%collector booster%sealed case%' THEN
    RETURN 'Collector Booster Box Case';
  ELSIF r LIKE '%play booster%case%' OR r LIKE '%draft booster%case%'
        OR r LIKE '%set booster%case%' OR r LIKE '%beyond booster%case%'
        OR r LIKE '%booster box%case%' OR r LIKE '%booster%display%case%' THEN
    RETURN 'Booster Box Case';
  ELSIF r LIKE '%bundle%case%' THEN
    RETURN 'Bundle Case';
  ELSIF r LIKE '%commander deck%case%' OR r LIKE '%commander%deck%case%' THEN
    RETURN 'Commander Deck Case';
  ELSIF r LIKE '%starter collection%case%' THEN
    RETURN 'Starter Collection Case';
  ELSIF r LIKE '%starter kit%case%' THEN
    RETURN 'Starter Kit Case';
  ELSIF r LIKE '%beginner box%case%' THEN
    RETURN 'Beginner Box Case';
  ELSIF r LIKE '%scene box%case%' THEN
    RETURN 'Scene Box Case';
  ELSIF r LIKE '%prerelease%case%' OR r LIKE '%pre-release%case%' THEN
    RETURN 'Pre Release Pack Case';
  ELSIF r LIKE '%jumpstart%case%' THEN
    RETURN 'Jumpstart Booster Display Case';
  END IF;

  -- ======== NON-CASE VARIANTS (original logic) ========
  -- Order matters: check most specific first
  -- Collector products must be checked before generic booster patterns
  IF r LIKE '%collector booster display%' OR r LIKE '%collector booster box%' THEN
    RETURN 'Collector Booster Box';
  ELSIF r LIKE '%collector booster pack%' OR r LIKE '%collector booster%'
        OR r LIKE '%sleeved%collector%' THEN
    RETURN 'Collector Booster Pack';
  ELSIF r LIKE '%play booster display%' OR r LIKE '%play booster box%' THEN
    RETURN 'Booster Box';
  ELSIF r LIKE '%jumpstart booster display%' OR r LIKE '%jumpstart display%'
        OR r LIKE '%jumpstart booster box%' THEN
    RETURN 'Jumpstart Booster Display';
  ELSIF r LIKE '%beyond booster box%' OR r LIKE '%beyond booster display%' THEN
    RETURN 'Booster Box';
  ELSIF r LIKE '%set booster box%' OR r LIKE '%set booster display%' THEN
    RETURN 'Booster Box';
  ELSIF r LIKE '%draft booster box%' OR r LIKE '%draft booster display%' THEN
    RETURN 'Booster Box';
  ELSIF r LIKE '%booster box%' THEN
    RETURN 'Booster Box';
  ELSIF r LIKE '%play booster pack%'
        OR r LIKE '%draft booster pack%' OR r LIKE '%set booster pack%'
        OR r LIKE '%beyond booster pack%' OR r LIKE '%booster pack%'
        OR r LIKE '%sleeved%booster%' THEN
    RETURN 'Booster Pack';
  ELSIF r LIKE '%commander deck%set%' OR r LIKE '%commander deck display%'
        OR r LIKE '%set of 4 deck%' OR r LIKE '%set of 5 deck%'
        OR r LIKE '%commander decks%' OR r LIKE '%commander deck bundle%' THEN
    RETURN 'Commander Deck Set';
  ELSIF r LIKE '%commander deck collector%' OR r LIKE '%collector edition%'
        OR r LIKE '%collector commander%' THEN
    RETURN 'Commander Deck Collector Edition';
  ELSIF r LIKE '%commander deck%' OR r LIKE '%commander%deck%'
        OR r LIKE '%individual commander%' THEN
    RETURN 'Commander Deck';
  ELSIF r LIKE '%scene box display%' THEN
    RETURN 'Scene Box Display';
  ELSIF r LIKE '%scene box%' OR r LIKE '%scene boxes%' THEN
    RETURN 'Scene Box';
  ELSIF r LIKE '%pizza bundle%' OR r LIKE '%finish line bundle%'
        OR r LIKE '%chocobo bundle%' OR r LIKE '%chocobox bundle%'
        OR r LIKE '%gift edition bundle%' OR r LIKE '%gift bundle%'
        OR r LIKE '%commander''s bundle%' THEN
    RETURN 'Bundle';
  ELSIF r LIKE '%bundle%' THEN
    RETURN 'Bundle';
  ELSIF r LIKE '%prerelease%' OR r LIKE '%pre-release%' OR r LIKE '%pre release%'
        OR r LIKE '%prerelease kit%' THEN
    RETURN 'Pre Release Pack';
  ELSIF r LIKE '%draft night%' OR r LIKE '%draft kit%' THEN
    RETURN 'Draft Night Kit';
  ELSIF r LIKE '%theme deck%' OR r LIKE '%60-card%' OR r LIKE '%precon%deck%' THEN
    RETURN 'Theme Deck';
  ELSIF r LIKE '%starter kit%' THEN
    RETURN 'Starter Kit';
  ELSIF r LIKE '%starter collection%' THEN
    RETURN 'Starter Collection';
  ELSIF r LIKE '%beginner box%' OR r LIKE '%learn to play%' THEN
    RETURN 'Beginner Box';
  ELSIF r LIKE '%secret lair%' THEN
    RETURN 'Secret Lair';
  ELSIF r LIKE '%video game deck%' THEN
    RETURN 'Video Game Deck';
  ELSIF r LIKE '%individual deck%' THEN
    RETURN 'Commander Deck';
  ELSIF r LIKE '%box topper%' THEN
    RETURN 'Box Topper';
  END IF;

  -- Check for standalone commander deck names (no "deck" keyword)
  IF r ~ '(counter blitz|limit break|revival trance|scions.*spellcraft|animated army|peace offering|conter.intelligence|world shaper|counter intelligence|death toll|eternal might|living energy|hail caesar|scrappy survivors|blast from the past|masters of evil|creative energy|eldrazi incursion|graveyard overdrive|tricky terrain|abzan armor|jeskai striker|mardu surge|sultai arisen|temur roar|ahoy mateys|blood rites|explorers of the deep|veloci.ramp.tor|family matters|squirreled away|arcane wizardry|paradox power|science commander|jump scare|endless punishment|miracle worker|mutant menace|timey.wimey)' THEN
    RETURN 'Commander Deck';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- STEP 2: Create canonical products for case variants from BotBox
-- ============================================================
INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT
  ks.set_name,
  detect_product_type(b.product_name) AS product_type,
  ks.set_type
FROM botbox_ev_calculations b
JOIN known_sets ks ON ks.set_name = trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', ''))
WHERE detect_product_type(b.product_name) IS NOT NULL
  AND detect_product_type(b.product_name) LIKE '%Case%'
ON CONFLICT (set_name, product_type) DO NOTHING;

-- ============================================================
-- STEP 3: Re-map BotBox case entries to the new canonical products
-- First remove old incorrect mappings for case products
-- ============================================================
DELETE FROM botbox_product_mappings
WHERE product_name ILIKE '%case%';

-- Re-map all case BotBox entries
INSERT INTO botbox_product_mappings (canonical_product_id, set_code, product_name)
SELECT DISTINCT ON (b.set_code, b.product_name)
  cp.id,
  b.set_code,
  b.product_name
FROM botbox_ev_calculations b
JOIN canonical_products cp ON (
  lower(cp.set_name) = lower(trim(regexp_replace(b.set_name, '\s*\([A-Z0-9]+\)\s*$', '')))
  AND lower(cp.product_type) = lower(detect_product_type(b.product_name))
)
WHERE lower(b.product_name) LIKE '%case%'
  AND detect_product_type(b.product_name) IS NOT NULL
ORDER BY b.set_code, b.product_name, length(cp.product_type) DESC
ON CONFLICT (set_code, product_name) DO UPDATE
  SET canonical_product_id = EXCLUDED.canonical_product_id;

-- ============================================================
-- STEP 4: Also fix marketplace offers that have "(Sealed Case)" in title
-- The classify_offer() trigger strips "(Sealed Case)" before detecting type.
-- Re-classify offers containing "case" so they get the Case product_type.
-- ============================================================
UPDATE offers SET product_type =
  CASE
    WHEN product_type = 'Collector Booster Box' AND lower(title) LIKE '%case%' THEN 'Collector Booster Box Case'
    WHEN product_type = 'Booster Box' AND lower(title) LIKE '%case%' THEN 'Booster Box Case'
    WHEN product_type = 'Bundle' AND lower(title) LIKE '%case%' THEN 'Bundle Case'
    WHEN product_type = 'Commander Deck' AND lower(title) LIKE '%case%' THEN 'Commander Deck Case'
    WHEN product_type = 'Commander Deck Set' AND lower(title) LIKE '%case%' THEN 'Commander Deck Case'
    WHEN product_type = 'Starter Collection' AND lower(title) LIKE '%case%' THEN 'Starter Collection Case'
    WHEN product_type = 'Starter Kit' AND lower(title) LIKE '%case%' THEN 'Starter Kit Case'
    WHEN product_type = 'Beginner Box' AND lower(title) LIKE '%case%' THEN 'Beginner Box Case'
    WHEN product_type = 'Scene Box' AND lower(title) LIKE '%case%' THEN 'Scene Box Case'
    WHEN product_type = 'Pre Release Pack' AND lower(title) LIKE '%case%' THEN 'Pre Release Pack Case'
    WHEN product_type = 'Jumpstart Booster Display' AND lower(title) LIKE '%case%' THEN 'Jumpstart Booster Display Case'
    ELSE product_type
  END
WHERE lower(title) LIKE '%case%'
  AND product_type IS NOT NULL
  AND product_type NOT LIKE '%Case%';

-- Create canonical products for any new case types from marketplace offers
INSERT INTO canonical_products (set_name, product_type, set_type)
SELECT DISTINCT set_name, product_type, set_type
FROM offers
WHERE product_type LIKE '%Case%'
  AND set_name IS NOT NULL
  AND is_sealed = true
ON CONFLICT (set_name, product_type) DO NOTHING;

-- Link offers to canonical products for case types
UPDATE offers o SET canonical_product_id = cp.id
FROM canonical_products cp
WHERE o.set_name = cp.set_name AND o.product_type = cp.product_type
  AND o.product_type LIKE '%Case%'
  AND (o.canonical_product_id IS NULL OR o.canonical_product_id != cp.id);

-- ============================================================
-- STEP 5: Fix classify_offer() to preserve "case" info
-- The old trigger strips "(Sealed Case)" entirely. Replace it with
-- just "Case" so detect_product_type() can still detect it.
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
BEGIN
  -- Skip if already fully classified
  IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL THEN
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
    FOR r IN SELECT ks.set_name, ks.set_type FROM known_sets ks
             ORDER BY length(ks.set_name) DESC LOOP
      IF lower(t_norm) LIKE lower(r.set_name) || '%' THEN
        matched_set := r.set_name;
        matched_type := r.set_type;
        remainder := trim(substring(t_norm from length(r.set_name) + 1));
        EXIT;
      END IF;
    END LOOP;
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
    RETURN NEW;
  END IF;

  -- === SC_ SKU HANDLING ===
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
        RETURN NEW;
      END IF;
    END IF;

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

    RETURN NEW;
  END IF;

  -- === STANDARD TITLE MATCHING ===
  t_norm := t;
  t_norm := regexp_replace(t_norm, '^Magic:?\s*[Tt]he Gathering\s*[-:]*\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '^\s*MTG\s*[-:]\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '^Universes Beyond\s*[:]*\s*', '', 'i');
  -- Trailing noise - replace "(Sealed Case)" with " Case" to preserve case info
  t_norm := regexp_replace(t_norm, '\s*\(PREORDER\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Presell\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Bulk Discounts\)\s*$', '', 'i');
  t_norm := regexp_replace(t_norm, '\s*\(Sealed Case\)\s*$', ' Case', 'i');
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

  -- Auto-create canonical product and link
  IF NEW.set_name IS NOT NULL AND NEW.product_type IS NOT NULL AND NEW.is_sealed = true THEN
    INSERT INTO canonical_products (set_name, product_type, set_type)
    VALUES (NEW.set_name, NEW.product_type, NEW.set_type)
    ON CONFLICT (set_name, product_type) DO NOTHING;

    SELECT id INTO NEW.canonical_product_id
    FROM canonical_products
    WHERE set_name = NEW.set_name AND product_type = NEW.product_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 6: Refresh materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 7: Verify
-- ============================================================
SELECT 'Case canonical products' AS metric, count(*)::text AS value
FROM canonical_products WHERE product_type LIKE '%Case%'
UNION ALL
SELECT 'Case BotBox mappings', count(*)::text
FROM botbox_product_mappings WHERE product_name ILIKE '%case%'
UNION ALL
SELECT 'Case marketplace offers', count(*)::text
FROM offers WHERE product_type LIKE '%Case%' AND is_sealed = true;

-- Show case products with their EV data
SELECT cp.set_name, cp.product_type, b.product_name, b.expected_value, b.market_price
FROM canonical_products cp
JOIN botbox_product_mappings bpm ON bpm.canonical_product_id = cp.id
JOIN botbox_ev_calculations b ON b.set_code = bpm.set_code AND b.product_name = bpm.product_name
WHERE cp.product_type LIKE '%Case%'
ORDER BY cp.set_name, cp.product_type
LIMIT 30;
