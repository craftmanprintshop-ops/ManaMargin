-- Migration 002: Classify offers - set_name, set_type, product_type, is_sealed
-- Run in Supabase SQL Editor
--
-- This migration:
-- 1. Creates a classify_offer() function that fuzzy-matches titles to set names
-- 2. Backfills all offers missing set_name or product_type
-- 3. Marks non-sealed items (singles, accessories, junk)
-- 4. Installs as a BEFORE INSERT trigger for future offers

-- ============================================================
-- STEP 1: Add is_sealed column
-- ============================================================
ALTER TABLE offers ADD COLUMN IF NOT EXISTS is_sealed boolean DEFAULT true;

-- ============================================================
-- STEP 2: Create the set_name lookup table
-- ============================================================
CREATE TABLE IF NOT EXISTS known_sets (
  set_name text PRIMARY KEY,
  set_type text,
  aliases text[] DEFAULT '{}'
);

-- Populate with comprehensive set list + aliases for all marketplace title formats
INSERT INTO known_sets (set_name, set_type, aliases)
VALUES
  -- Major current/recent sets (ordered by recency)
  ('Teenage Mutant Ninja Turtles', 'expansion', '{"TMNT"}'),
  ('Marvel''s Spider-Man', 'expansion', '{"Marvel Spider-Man","Spider-Man","Marvel Super Heroes","Marvel Superheroes","MARVEL_SUPERHEROES","MSH"}'),
  ('Lorwyn Eclipsed', 'expansion', '{"Eclipsed"}'),
  ('Edge of Eternities', 'expansion', '{"SPACEOPERA","Space Opera"}'),
  ('Tarkir: Dragonstorm', 'expansion', '{"Tarkir Dragonstorm","Tarkir - Dragonstorm"}'),
  ('Avatar: The Last Airbender', 'expansion', '{"Avatar the Last Airbender","Avatar The Last Airbender","ATLA","Avatar Last Airbender","The Last Airbender"}'),
  ('Final Fantasy', 'expansion', '{"FINALFANTASY"}'),
  ('Aetherdrift', 'expansion', '{"DEATHRACE"}'),
  ('Innistrad Remastered', 'masters', '{}'),
  ('Foundations', 'core', '{"FND"}'),
  ('Duskmourn: House of Horror', 'expansion', '{"Duskmourn","DMHH"}'),
  ('Bloomburrow', 'expansion', '{"BLB"}'),
  ('Assassin''s Creed', 'draft_innovation', '{}'),
  ('Modern Horizons 3', 'draft_innovation', '{"MH3","MHT"}'),
  ('Outlaws of Thunder Junction', 'expansion', '{"OTJ"}'),
  ('Murders at Karlov Manor', 'expansion', '{}'),
  ('The Lost Caverns of Ixalan', 'expansion', '{"Lost Caverns of Ixalan","TLCOI"}'),
  ('Wilds of Eldraine', 'expansion', '{}'),
  ('The Lord of the Rings: Tales of Middle-earth', 'draft_innovation', '{"LOTR","Lord of the Rings","Lord of the Rings Tales of Middle-Earth","Tales of Middle-Earth","Tales of Middle-earth","The Lord of the Rings - Tales of Middle-Earth","The Lord of the Rings Tales of Middle-Earth"}'),
  ('Commander Masters', 'masters', '{}'),
  ('March of the Machine', 'expansion', '{}'),
  ('Phyrexia: All Will Be One', 'expansion', '{"Phyrexia All Will Be One","Phyrexia - All Will Be One"}'),
  ('Dominaria United', 'expansion', '{}'),
  ('Streets of New Capenna', 'expansion', '{}'),
  ('Kamigawa: Neon Dynasty', 'expansion', '{"Kamigawa Neon Dynasty"}'),
  ('Innistrad: Midnight Hunt', 'expansion', '{"Innistrad Midnight Hunt"}'),
  ('Strixhaven: School of Mages', 'expansion', '{"STX","Strixhaven"}'),
  ('Zendikar Rising', 'expansion', '{}'),
  ('Theros Beyond Death', 'expansion', '{}'),
  ('Throne of Eldraine', 'expansion', '{}'),
  ('Ravnica Remastered', 'masters', '{}'),
  ('Dominaria Remastered', 'masters', '{}'),
  ('Jumpstart 2022', 'draft_innovation', '{}'),
  ('Jumpstart', 'draft_innovation', '{}'),
  ('Doctor Who', 'commander', '{"DRWHO","DOCTORWHO"}'),
  ('Warhammer 40,000', 'commander', '{}'),
  ('Fallout', 'commander', '{}'),
  ('Modern Horizons 2', 'draft_innovation', '{"MH2"}'),
  ('Unfinity', 'funny', '{}'),
  ('Commander 2017', 'commander', '{}'),
  ('Innistrad', 'expansion', '{}'),
  ('Modern Masters 2017', 'masters', '{}'),
  ('Beta', 'core', '{}'),
  -- Upcoming / new sets
  ('Star Trek', 'expansion', '{"STARTREK"}'),
  -- Starter/Commander-specific products
  ('Starter Commander Decks', 'commander', '{"Starter Commander Deck"}'),
  ('Commander Legends: Battle for Baldur''s Gate', 'draft_innovation', '{"Commander Legends D&D Battle for Baldur''s Gate","BBG"}'),
  ('Commander Legends', 'draft_innovation', '{}'),
  -- Secret Lair (collectorstore / geekerygames / tradingcardmarket)
  ('Secret Lair', 'secret_lair', '{}'),
  -- Non-MTG (tracked by some stores)
  ('Gundam', 'other', '{}')
ON CONFLICT (set_name) DO UPDATE SET
  set_type = EXCLUDED.set_type,
  aliases = EXCLUDED.aliases;

-- Also pull in any existing classified set names we missed
INSERT INTO known_sets (set_name, set_type)
SELECT DISTINCT o.set_name, o.set_type
FROM offers o
WHERE o.set_name IS NOT NULL
  AND o.set_name NOT IN (SELECT set_name FROM known_sets)
  AND o.set_name !~ '^\[' -- skip broken "[" entries
  AND o.set_name NOT ILIKE '%drop series%'
  AND o.set_name NOT ILIKE '%secret lair%'
ON CONFLICT (set_name) DO NOTHING;

-- ============================================================
-- STEP 3: Create SC_ set code lookup table
-- Maps Saga Concepts internal set codes to canonical set names
-- ============================================================
CREATE TABLE IF NOT EXISTS sc_set_codes (
  code text PRIMARY KEY,
  set_name text NOT NULL REFERENCES known_sets(set_name)
);

INSERT INTO sc_set_codes (code, set_name)
VALUES
  ('BLB', 'Bloomburrow'),
  ('DEATHRACE', 'Aetherdrift'),
  ('DMHH', 'Duskmourn: House of Horror'),
  ('DOCTORWHO', 'Doctor Who'),
  ('DRWHO', 'Doctor Who'),
  ('FINALFANTASY', 'Final Fantasy'),
  ('FND', 'Foundations'),
  ('MAR26', 'Lorwyn Eclipsed'),
  ('MHT', 'Modern Horizons 3'),
  ('MARVEL', 'Marvel''s Spider-Man'),
  ('MSH', 'Marvel''s Spider-Man'),
  ('OTJ', 'Outlaws of Thunder Junction'),
  ('RT_LORWYN', 'Lorwyn Eclipsed'),
  ('RT_TARKIR', 'Tarkir: Dragonstorm'),
  ('SPACEOPERA', 'Edge of Eternities'),
  ('STARTREK', 'Star Trek'),
  ('CCG_TLCOI', 'The Lost Caverns of Ixalan'),
  ('MTGAIB', 'Avatar: The Last Airbender'),
  ('BBG', 'Commander Legends: Battle for Baldur''s Gate'),
  ('STX', 'Strixhaven: School of Mages'),
  ('TH', 'Teenage Mutant Ninja Turtles')
ON CONFLICT (code) DO UPDATE SET set_name = EXCLUDED.set_name;

-- ============================================================
-- STEP 3b: Create commander deck name -> set mapping
-- Maps individual deck names to their parent set
-- ============================================================
CREATE TABLE IF NOT EXISTS commander_deck_sets (
  deck_name text PRIMARY KEY,
  set_name text NOT NULL REFERENCES known_sets(set_name)
);

INSERT INTO commander_deck_sets (deck_name, set_name)
VALUES
  ('animated army', 'Bloomburrow'),
  ('family matters', 'Bloomburrow'),
  ('peace offering', 'Bloomburrow'),
  ('squirreled away', 'Bloomburrow'),
  ('eternal might', 'Aetherdrift'),
  ('living energy', 'Aetherdrift'),
  ('counter intelligence', 'Edge of Eternities'),
  ('conter-intelligence', 'Edge of Eternities'),
  ('world shaper', 'Edge of Eternities'),
  ('counter blitz', 'Final Fantasy'),
  ('limit break', 'Final Fantasy'),
  ('revival trance', 'Final Fantasy'),
  ('death toll', 'Duskmourn: House of Horror'),
  ('jump scare', 'Duskmourn: House of Horror'),
  ('endless punishment', 'Duskmourn: House of Horror'),
  ('miracle worker', 'Duskmourn: House of Horror'),
  ('hail caesar', 'Fallout'),
  ('science', 'Fallout'),
  ('scrappy survivors', 'Fallout'),
  ('mutant menace', 'Fallout'),
  ('blast from the past', 'Doctor Who'),
  ('masters of evil', 'Doctor Who'),
  ('paradox power', 'Doctor Who'),
  ('timey-wimey', 'Doctor Who'),
  ('creative energy', 'Modern Horizons 3'),
  ('eldrazi incursion', 'Modern Horizons 3'),
  ('graveyard overdrive', 'Modern Horizons 3'),
  ('tricky terrain', 'Modern Horizons 3'),
  ('abzan armor', 'Tarkir: Dragonstorm'),
  ('jeskai striker', 'Tarkir: Dragonstorm'),
  ('mardu surge', 'Tarkir: Dragonstorm'),
  ('sultai arisen', 'Tarkir: Dragonstorm'),
  ('temur roar', 'Tarkir: Dragonstorm'),
  ('ahoy mateys', 'The Lost Caverns of Ixalan'),
  ('blood rites', 'The Lost Caverns of Ixalan'),
  ('explorers of the deep', 'The Lost Caverns of Ixalan'),
  ('arcane wizardry', 'Commander 2017')
ON CONFLICT (deck_name) DO UPDATE SET set_name = EXCLUDED.set_name;

-- ============================================================
-- STEP 4: Create detect_product_type() helper function
-- ============================================================
CREATE OR REPLACE FUNCTION detect_product_type(remainder text)
RETURNS text AS $$
DECLARE
  r text := lower(COALESCE(remainder, ''));
BEGIN
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
-- STEP 5: Create the classify_offer() trigger function
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
      -- Try to extract set code from SKU pattern: SC_MTG_{CODE}_{rest} or SC_{CODE}_{rest}
      -- Handle SC_MTGAIB specially (no underscore separation)
      IF t LIKE 'SC_MTGAIB%' THEN
        sc_code := 'MTGAIB';
      ELSIF t LIKE 'SC_MTG_CCG_%' THEN
        -- e.g. SC_MTG_CCG_TLCOI_CD_AHOYMATEYS
        sc_code := (regexp_match(t, '^SC_MTG_(CCG_[A-Z]+)'))[1];
      ELSIF t LIKE 'SC_MTG_RT_%' THEN
        -- e.g. SC_MTG_RT_LORWYN_CD, SC_MTG_RT_TARKIR_CD
        sc_code := (regexp_match(t, '^SC_MTG_(RT_[A-Z]+)'))[1];
      ELSIF t LIKE 'SC_MTG_%' THEN
        -- Standard: SC_MTG_{CODE}_{rest}
        sc_code := (regexp_match(t, '^SC_MTG_([A-Z0-9]+)'))[1];
      ELSIF t LIKE 'SC_BBG_%' THEN
        sc_code := 'BBG';
      ELSIF t LIKE 'SC_WOC%' THEN
        -- Wizards product codes, skip set detection
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
  -- Strip common prefixes (handles all marketplace formats)
  t_norm := t;
  -- "Magic: The Gathering - ..." or "Magic The Gathering ..."
  t_norm := regexp_replace(t_norm, '^Magic:?\s*[Tt]he Gathering\s*[-:]*\s*', '', 'i');
  t_norm := regexp_replace(t_norm, '^\s*MTG\s*[-:]\s*', '', 'i');
  -- "Universes Beyond: ..." or "Universes Beyond " prefix (after stripping MTG prefix)
  t_norm := regexp_replace(t_norm, '^Universes Beyond\s*[:]*\s*', '', 'i');
  -- Trailing noise
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

  -- Secret Lair: if product_type is already Secret Lair, set set_name
  IF NEW.set_name IS NULL AND (NEW.product_type = 'Secret Lair' OR t_lower LIKE '%secret lair%') THEN
    NEW.set_name := 'Secret Lair';
    NEW.set_type := 'secret_lair';
    IF NEW.product_type IS NULL THEN NEW.product_type := 'Secret Lair'; END IF;
  END IF;

  -- If still no set or product type, mark non-sealed
  IF NEW.set_name IS NULL AND NEW.product_type IS NULL THEN
    NEW.is_sealed := false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 6: Backfill all offers missing set_name or product_type
-- ============================================================

-- First mark junk/singles/accessories
UPDATE offers SET is_sealed = false
WHERE title IS NULL OR title = 'null'
   OR title ILIKE 'filter:%' OR title ILIKE 'sort by:%';

UPDATE offers SET is_sealed = false
WHERE product_type IS NULL AND set_name IS NULL
  AND (
    title ~ '\([A-Z]{2,5}-\d{2,4}\)'
    OR title ~ '\((LP|NM|MP|HP|DMG)\)'
    OR title ILIKE '%(extended art)%' OR title ILIKE '%(borderless)%'
    OR title ILIKE '%(showcase)%' OR title ILIKE '%(retro frame)%'
    OR title ILIKE '%(full art)%' OR title ILIKE '%(devoid)%'
    OR title ILIKE '%(snow)%' OR title ILIKE '%limited edition beta%'
  );

UPDATE offers SET is_sealed = false
WHERE product_type IS NULL AND set_name IS NULL
  AND (
    title ILIKE '%sleeve%' OR title ILIKE '%playmat%'
    OR title ILIKE '%deck box%' OR title ILIKE '%binder%'
    OR title ILIKE '%collector case%' OR title ILIKE '%mystery pin%'
    OR title ILIKE '%box topper%' OR title ILIKE '%token set%'
    OR title ILIKE '%token divider%' OR title ILIKE '%erasable token%'
    OR title ILIKE '%relic token%' OR title ILIKE '%phunny plush%'
    OR title ILIKE '%land station%' OR title ILIKE '%dragon shield%'
    OR title ILIKE '%ultra pro%' OR title ILIKE '%ultimate guard%'
    OR title ILIKE '%mox emerald%' OR title ILIKE '%planechase set of%'
    OR title ILIKE '%warhammer 40k%' OR title ILIKE '%magiccon%'
  );

-- Now backfill set_name, set_type, product_type for all remaining unclassified
DO $$
DECLARE
  rec record;
  t_norm text;
  t_lower text;
  remainder text;
  matched_set text;
  matched_type text;
  detected_pt text;
  r record;
  sc_code text;
  updated_count integer := 0;
BEGIN
  FOR rec IN
    SELECT id, title, set_name, set_type, product_type, marketplace
    FROM offers
    WHERE (is_sealed IS NULL OR is_sealed = true)
      AND (set_name IS NULL OR product_type IS NULL)
      AND title IS NOT NULL
    ORDER BY fetched_at DESC
  LOOP
    matched_set := rec.set_name;
    matched_type := rec.set_type;
    detected_pt := rec.product_type;
    t_norm := rec.title;
    remainder := NULL;

    -- === Handle FF_ SKUs ===
    IF t_norm LIKE 'FF_%' THEN
      t_norm := replace(substring(t_norm from 4), '_', ' ');
      -- Match against known sets
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
      IF detected_pt IS NULL THEN
        detected_pt := detect_product_type(COALESCE(remainder, t_norm));
      END IF;
      IF matched_set IS NOT NULL OR detected_pt IS NOT NULL THEN
        UPDATE offers SET
          set_name = COALESCE(rec.set_name, matched_set),
          set_type = COALESCE(rec.set_type, matched_type),
          product_type = COALESCE(rec.product_type, detected_pt)
        WHERE id = rec.id;
        updated_count := updated_count + 1;
      ELSE
        UPDATE offers SET is_sealed = false WHERE id = rec.id;
      END IF;
      CONTINUE;
    END IF;

    -- === Handle SC_ SKUs ===
    IF rec.title LIKE 'SC_%' THEN
      -- Decode product type
      IF detected_pt IS NULL THEN
        IF rec.title LIKE '%_CDC%' OR rec.title LIKE '%_CE_CD_%' THEN
          detected_pt := 'Commander Deck Set';
        ELSIF (rec.title LIKE '%_CD_%' OR rec.title LIKE '%_CD') AND rec.title NOT LIKE '%_CDC%' AND rec.title NOT LIKE '%_CE_CD_%' THEN
          detected_pt := 'Commander Deck';
        ELSIF rec.title LIKE '%_CB' OR rec.title LIKE '%_CB_%' OR rec.title LIKE '%_CBD%' THEN
          detected_pt := 'Collector Booster Display';
        ELSIF (rec.title LIKE '%_PB' OR rec.title LIKE '%_PB_%') AND rec.title NOT LIKE '%_PZB%' THEN
          detected_pt := 'Play Booster Display';
        ELSIF rec.title LIKE '%_DB' OR rec.title LIKE '%_DB_%' THEN
          detected_pt := 'Booster Box';
        ELSIF rec.title LIKE '%_BNDL%' OR rec.title LIKE '%_PZB%' THEN
          detected_pt := 'Bundle';
        ELSIF rec.title LIKE '%_PREPACK%' OR rec.title LIKE '%_PRPACK%' OR rec.title LIKE '%_PP' THEN
          detected_pt := 'Pre Release Pack';
        ELSIF rec.title LIKE '%_JBD%' OR lower(rec.title) LIKE '%jumpstartboosterdisplay%' THEN
          detected_pt := 'Jumpstart Booster Display';
        ELSIF rec.title LIKE '%_SBD_%' OR rec.title LIKE '%_SCENE%' THEN
          detected_pt := 'Scene Box';
        ELSIF rec.title LIKE '%_SKC_%' THEN
          detected_pt := 'Starter Kit';
        ELSIF rec.title LIKE '%_TD_%' OR rec.title LIKE '%PRECONDCK%' OR rec.title LIKE '%PRECON_DECK%' THEN
          detected_pt := 'Theme Deck';
        ELSIF rec.title LIKE '%_DN%' THEN
          detected_pt := 'Draft Night Kit';
        ELSIF rec.title LIKE '%_TB_%' THEN
          detected_pt := 'Theme Deck';
        ELSE
          UPDATE offers SET is_sealed = false WHERE id = rec.id;
          CONTINUE;
        END IF;
      END IF;

      -- Decode set name from SC_ code
      IF matched_set IS NULL THEN
        sc_code := NULL;
        IF rec.title LIKE 'SC_MTGAIB%' THEN
          sc_code := 'MTGAIB';
        ELSIF rec.title LIKE 'SC_MTG_CCG_%' THEN
          sc_code := (regexp_match(rec.title, '^SC_MTG_(CCG_[A-Z]+)'))[1];
        ELSIF rec.title LIKE 'SC_MTG_RT_%' THEN
          sc_code := (regexp_match(rec.title, '^SC_MTG_(RT_[A-Z]+)'))[1];
        ELSIF rec.title LIKE 'SC_MTG_%' THEN
          sc_code := (regexp_match(rec.title, '^SC_MTG_([A-Z0-9]+)'))[1];
        ELSIF rec.title LIKE 'SC_BBG_%' THEN
          sc_code := 'BBG';
        END IF;

        IF sc_code IS NOT NULL THEN
          SELECT ssc.set_name INTO matched_set FROM sc_set_codes ssc WHERE ssc.code = sc_code;
          IF matched_set IS NOT NULL THEN
            SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
          END IF;
        END IF;
      END IF;

      UPDATE offers SET
        product_type = COALESCE(rec.product_type, detected_pt),
        set_name = COALESCE(rec.set_name, matched_set),
        set_type = COALESCE(rec.set_type, matched_type)
      WHERE id = rec.id;
      updated_count := updated_count + 1;
      CONTINUE;
    END IF;

    -- === Standard title matching ===
    -- Strip common prefixes (handles ALL marketplace formats)
    t_norm := regexp_replace(t_norm, '^Magic:?\s*[Tt]he Gathering\s*[-:]*\s*', '', 'i');
    t_norm := regexp_replace(t_norm, '^\s*MTG\s*[-:]\s*', '', 'i');
    -- Strip "Universes Beyond" prefix
    t_norm := regexp_replace(t_norm, '^Universes Beyond\s*[:]*\s*', '', 'i');
    -- Strip trailing noise
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
           OR t_lower LIKE lower(r.set_name) || ' 60-card%'
           OR t_lower LIKE lower(r.set_name) || ' plastic%'
           OR t_lower LIKE lower(r.set_name) || ' precon%'
           OR t_lower LIKE lower(r.set_name) || ' (%'
           OR t_lower LIKE lower(r.set_name) || ' [%' THEN
          matched_set := r.set_name;
          matched_type := r.set_type;
          remainder := trim(substring(t_norm from length(r.set_name) + 1));
          remainder := regexp_replace(remainder, '^\s*[-:]\s*', '');
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- Try aliases
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

    -- Detect product type
    IF detected_pt IS NULL THEN
      detected_pt := detect_product_type(COALESCE(remainder, t_norm));
    END IF;

    -- Deck-name -> set mapping for individual commander decks
    IF matched_set IS NULL AND detected_pt = 'Commander Deck' THEN
      SELECT cds.set_name INTO matched_set
      FROM commander_deck_sets cds
      WHERE t_lower LIKE '%' || cds.deck_name || '%'
      ORDER BY length(cds.deck_name) DESC
      LIMIT 1;
      IF matched_set IS NOT NULL THEN
        SELECT ks.set_type INTO matched_type FROM known_sets ks WHERE ks.set_name = matched_set;
      END IF;
    END IF;

    -- Secret Lair matching
    IF matched_set IS NULL AND (detected_pt = 'Secret Lair' OR t_lower LIKE '%secret lair%') THEN
      matched_set := 'Secret Lair';
      matched_type := 'secret_lair';
      IF detected_pt IS NULL THEN detected_pt := 'Secret Lair'; END IF;
    END IF;

    -- SC_MAGIC_THE_GATHERING_CCG_ special format
    IF matched_set IS NULL AND rec.title LIKE 'SC_MAGIC_THE_GATHERING_CCG_%' THEN
      t_norm := replace(replace(rec.title, 'SC_MAGIC_THE_GATHERING_CCG_', ''), '_', ' ');
      FOR r IN SELECT ks.set_name, ks.set_type FROM known_sets ks
               ORDER BY length(ks.set_name) DESC LOOP
        IF lower(t_norm) LIKE lower(r.set_name) || '%' THEN
          matched_set := r.set_name;
          matched_type := r.set_type;
          EXIT;
        END IF;
      END LOOP;
      IF detected_pt IS NULL THEN
        detected_pt := detect_product_type(t_norm);
      END IF;
    END IF;

    -- Apply updates
    IF matched_set IS NOT NULL OR detected_pt IS NOT NULL THEN
      UPDATE offers SET
        set_name = COALESCE(rec.set_name, matched_set),
        set_type = COALESCE(rec.set_type, matched_type),
        product_type = COALESCE(rec.product_type, detected_pt)
      WHERE id = rec.id;
      updated_count := updated_count + 1;
    ELSE
      UPDATE offers SET is_sealed = false WHERE id = rec.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'Updated % offers', updated_count;
END $$;

-- ============================================================
-- STEP 7: Final cleanup - mark remaining unclassified as non-sealed
-- ============================================================
UPDATE offers SET is_sealed = false
WHERE product_type IS NULL AND is_sealed = true;

-- ============================================================
-- STEP 8: Install triggers for future inserts
-- ============================================================
DROP TRIGGER IF EXISTS trg_classify_offer_extras ON offers;
DROP TRIGGER IF EXISTS trg_classify_offer ON offers;

CREATE TRIGGER trg_classify_offer
  BEFORE INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION classify_offer();

-- ============================================================
-- STEP 9: Refresh the materialized view
-- ============================================================
SELECT refresh_offers_latest_enriched_mv();

-- ============================================================
-- STEP 10: Verify results
-- ============================================================
SELECT 'Total offers' as metric, count(*)::text as value FROM offers
UNION ALL
SELECT 'Sealed (is_sealed=true)', count(*)::text FROM offers WHERE is_sealed = true
UNION ALL
SELECT 'Non-sealed (is_sealed=false)', count(*)::text FROM offers WHERE is_sealed = false
UNION ALL
SELECT 'With set_name', count(*)::text FROM offers WHERE set_name IS NOT NULL
UNION ALL
SELECT 'Without set_name (sealed)', count(*)::text FROM offers WHERE set_name IS NULL AND is_sealed = true
UNION ALL
SELECT 'With product_type', count(*)::text FROM offers WHERE product_type IS NOT NULL
UNION ALL
SELECT 'In enriched MV', count(*)::text FROM offers_latest_enriched_mv
UNION ALL
SELECT 'Distinct sets in MV', count(DISTINCT set_name)::text FROM offers_latest_enriched_mv WHERE set_name IS NOT NULL
UNION ALL
SELECT 'Distinct product_types in MV', count(DISTINCT product_type)::text FROM offers_latest_enriched_mv WHERE product_type IS NOT NULL;

-- Show remaining unclassified sealed offers (should be zero or very few)
SELECT marketplace, title, set_name, product_type
FROM offers
WHERE is_sealed = true AND set_name IS NULL
ORDER BY marketplace, title
LIMIT 30;
