-- Migration 020: plain-column import markers for allprintings_sets
--
-- The incremental MTGJSON import (scraper/jobs/mtgjson-allprintings-sets.mjs)
-- tracks "already imported" state as raw->'_import' inside the jsonb `raw`
-- column. That value has been observed to disappear roughly a day after
-- being written, with no identifiable cause (ruled out: the app code, a DB
-- trigger stripping it, GitHub Actions history, this machine's scheduled
-- tasks, Edge Functions, and pg_cron -- which is disabled on this project).
-- The write/read logic itself was verified correct: writing the marker and
-- immediately re-running the import shows it correctly skipping all sets.
--
-- This adds plain typed columns as a sturdier alternative to the buried
-- jsonb key, and backfills them from any markers that currently exist so
-- today's import work isn't discarded.

ALTER TABLE allprintings_sets
  ADD COLUMN IF NOT EXISTS import_card_rows INTEGER,
  ADD COLUMN IF NOT EXISTS import_source_total INTEGER,
  ADD COLUMN IF NOT EXISTS import_completed_at TIMESTAMPTZ;

UPDATE allprintings_sets
SET
  import_card_rows = (raw -> '_import' ->> 'card_rows')::INTEGER,
  import_source_total = (raw -> '_import' ->> 'source_total')::INTEGER,
  import_completed_at = (raw -> '_import' ->> 'imported_at')::TIMESTAMPTZ
WHERE raw -> '_import' IS NOT NULL;
