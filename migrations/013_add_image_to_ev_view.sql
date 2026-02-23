-- Migration 013: Add image_url to v_ev_with_best_offers
-- Run in Supabase SQL Editor AFTER 012
--
-- Adds best_image_url so the dashboard can show product images for EV deals.
-- Must DROP + CREATE because PostgreSQL doesn't allow adding columns
-- in the middle of a view with CREATE OR REPLACE.

DROP VIEW IF EXISTS v_ev_with_best_offers;
CREATE VIEW v_ev_with_best_offers AS
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
  -- Best price: use direct offer, or sum of individual decks (only when ALL matched)
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.marketplace
    WHEN deck_sum.sum_total IS NOT NULL
      THEN 'Individual Decks'
    ELSE NULL
  END AS best_marketplace,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.price
    WHEN deck_sum.sum_total IS NOT NULL
      THEN deck_sum.sum_total
    ELSE NULL
  END AS best_price,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.shipping
    ELSE 0::numeric
  END AS best_shipping,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN (best.price + COALESCE(best.shipping, 0))
    WHEN deck_sum.sum_total IS NOT NULL
      THEN deck_sum.sum_total
    ELSE NULL
  END AS best_total,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.url
    ELSE NULL
  END AS best_url,
  CASE
    WHEN best.price IS NOT NULL AND (deck_sum.sum_total IS NULL OR (best.price + COALESCE(best.shipping, 0)) <= deck_sum.sum_total)
      THEN best.image_url
    ELSE NULL
  END AS best_image_url,
  deck_sum.total_decks AS individual_deck_count,
  deck_sum.decks_with_offers AS individual_decks_matched
FROM botbox_ev_calculations b
JOIN botbox_product_mappings bpm ON (
  bpm.set_code = b.set_code
  AND bpm.product_name = b.product_name
)
JOIN canonical_products cp ON cp.id = bpm.canonical_product_id
-- Direct best offer: from current scrape data only
LEFT JOIN LATERAL (
  SELECT o.marketplace, o.price, o.shipping, o.url, o.image_url
  FROM offers_current o
  WHERE o.canonical_product_id = cp.id
    AND o.in_stock = true
    AND o.is_sealed = true
  ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
  LIMIT 1
) best ON true
-- Sum of individual deck best prices (only for Commander Deck Set)
LEFT JOIN LATERAL (
  SELECT
    CASE WHEN count(*) = count(ind_best.best_total) THEN sum(ind_best.best_total) ELSE NULL END AS sum_total,
    count(*) AS total_decks,
    count(ind_best.best_total) AS decks_with_offers
  FROM canonical_products ind_cp
  LEFT JOIN LATERAL (
    SELECT (o.price + COALESCE(o.shipping, 0)) AS best_total
    FROM offers_current o
    WHERE o.canonical_product_id = ind_cp.id
      AND o.in_stock = true
      AND o.is_sealed = true
    ORDER BY (o.price + COALESCE(o.shipping, 0)) ASC
    LIMIT 1
  ) ind_best ON true
  WHERE ind_cp.set_name = cp.set_name
    AND ind_cp.product_type LIKE 'Commander Deck %'
    AND ind_cp.product_type NOT IN (
      'Commander Deck Set', 'Commander Deck Case', 'Commander Deck Display',
      'Commander Deck Collector Edition'
    )
) deck_sum ON cp.product_type IN ('Commander Deck Set', 'Commander Deck Display')
WHERE b.expected_value IS NOT NULL
ORDER BY b.ev_to_price_ratio DESC NULLS LAST;

GRANT SELECT ON v_ev_with_best_offers TO anon, authenticated;
