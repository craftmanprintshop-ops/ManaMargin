-- Migration 006: BotBox EV Calculations table
--
-- Stores expected value, market price, and EV/price ratio data
-- scraped from https://botbox.dev/ev-calculations via n8n workflow.
-- Data is upserted on (set_code, product_name) so re-runs update in place.

CREATE TABLE IF NOT EXISTS botbox_ev_calculations (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    set_code        TEXT NOT NULL,
    set_name        TEXT,
    product_name    TEXT NOT NULL,
    expected_value  NUMERIC(10,2),
    market_price    NUMERIC(10,2),
    ev_to_price_ratio NUMERIC(8,4),
    variance        NUMERIC(20,2),
    expected_value_eur  NUMERIC(10,2),
    market_price_eur    NUMERIC(10,2),
    ev_to_price_ratio_eur NUMERIC(8,4),
    variance_eur    NUMERIC(20,2),
    calculation_timestamp TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_botbox_ev UNIQUE (set_code, product_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_botbox_ev_set_code ON botbox_ev_calculations (set_code);
CREATE INDEX IF NOT EXISTS idx_botbox_ev_ratio ON botbox_ev_calculations (ev_to_price_ratio DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_botbox_ev_set_name ON botbox_ev_calculations (set_name);

-- Grant access to Supabase roles
GRANT SELECT ON botbox_ev_calculations TO anon, authenticated;

-- Handy view: just the columns the frontend needs, sorted by best ratio
CREATE OR REPLACE VIEW v_botbox_ev_ranked AS
SELECT
    set_code,
    set_name,
    product_name,
    expected_value,
    market_price,
    ev_to_price_ratio,
    variance,
    calculation_timestamp,
    fetched_at
FROM botbox_ev_calculations
WHERE expected_value IS NOT NULL
  AND market_price IS NOT NULL
ORDER BY ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON v_botbox_ev_ranked TO anon, authenticated;
