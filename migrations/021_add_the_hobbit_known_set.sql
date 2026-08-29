-- Migration 021: register "The Hobbit" in known_sets, reclassify its offers
--
-- known_sets is a manually-curated lookup the classifier fuzzy-matches offer
-- titles against. New MTG sets have no entry until someone adds one, so every
-- offer for a brand-new set gets set_name = NULL, a garbage product_type
-- guess, and classified = true (meaning it's treated as done and never
-- automatically retried). The Products page groups by set_name and drops
-- NULLs, so the set is invisible there even though the raw offer/price data
-- is fine.
--
-- Aliases cover the retailer title stylings observed for The Hobbit:
--   "Magic: The Gathering - The Hobbit - X"        -> matches set_name directly
--   "Magic The Gathering The Hobbit X"              -> matches set_name directly
--   "Magic The Gathering: HOB The Hobbit X"         -> needs the HOB-prefixed alias
--   "Magic the Gathering CCG Universes Beyond The Hobbit X" -> needs that alias

INSERT INTO known_sets (set_name, set_type, aliases)
SELECT 'The Hobbit', 'expansion',
       ARRAY['HOB The Hobbit', 'CCG Universes Beyond The Hobbit', 'Universes Beyond The Hobbit']
WHERE NOT EXISTS (SELECT 1 FROM known_sets WHERE set_name = 'The Hobbit');

INSERT INTO known_sets (set_name, set_type, aliases)
SELECT 'The Hobbit Eternal', 'expansion', ARRAY[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM known_sets WHERE set_name = 'The Hobbit Eternal');

-- Reset the incorrectly-classified Hobbit offers so the batch classifier
-- reprocesses them against the new known_sets entry.
UPDATE offers
SET classified = false
WHERE title ILIKE '%hobbit%' AND classified = true;
