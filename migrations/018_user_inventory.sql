-- Migration 018: Per-user inventory table with RLS
-- Allows authenticated users to save inventory separately from others

CREATE TABLE IF NOT EXISTS user_inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_name      text NOT NULL,
  product_type  text NOT NULL,
  title         text NOT NULL,
  cost_paid     numeric(10,2) NOT NULL DEFAULT 0,
  count         integer NOT NULL DEFAULT 0,
  fee_percent   numeric(5,2) NOT NULL DEFAULT 15,
  shipping_cost numeric(10,2) NOT NULL DEFAULT 5,
  added_at      timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, set_name, product_type)
);

CREATE INDEX idx_user_inventory_user_id ON user_inventory(user_id);

-- RLS: users can only access their own rows
ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inventory"
  ON user_inventory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inventory"
  ON user_inventory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inventory"
  ON user_inventory FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inventory"
  ON user_inventory FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_user_inventory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_inventory_updated_at
  BEFORE UPDATE ON user_inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_user_inventory_timestamp();
