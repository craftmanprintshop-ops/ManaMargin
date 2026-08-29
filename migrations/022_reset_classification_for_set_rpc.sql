-- Migration 022: RPC to reprocess offers once a set becomes known
--
-- Used by scraper/jobs/sync-known-sets.mjs right after it registers a set
-- that wasn't in known_sets yet: any offer scraped before that point was
-- classified with set_name = NULL (unmatched) and marked classified = true,
-- so it will never be retried on its own. This resets classified = false for
-- offers whose title mentions the set, so the next classification pass
-- (every retailer scrape) picks them up correctly.
--
-- A real function parameter (not string-built SQL) so arbitrary set names --
-- including ones with punctuation like "Kamigawa: Neon Dynasty" -- are safe.

CREATE OR REPLACE FUNCTION reset_classification_for_set(p_set_name TEXT)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE offers
  SET classified = false
  WHERE classified = true
    AND title ILIKE '%' || p_set_name || '%';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reset_classification_for_set(TEXT) TO service_role;
