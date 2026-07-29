-- Migration 019: Web Push subscriptions with RLS
-- Stores browser push endpoints so the deal watcher can notify opted-in users.
--
-- One row per browser/device (endpoint is globally unique). A user who enables
-- alerts on their phone and their laptop gets two rows.
--
-- The watcher reads this table with the service role key, which bypasses RLS.
-- Users can only ever see or change their own rows.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The push service URL for this device, returned by PushManager.subscribe().
  endpoint      text NOT NULL UNIQUE,
  -- Encryption material from the same subscription object.
  p256dh        text NOT NULL,
  auth          text NOT NULL,

  user_agent    text,
  enabled       boolean NOT NULL DEFAULT true,

  -- Push services return 404/410 when a subscription dies (app deleted, iOS
  -- evicted storage). The watcher records that here and prunes.
  failure_count integer NOT NULL DEFAULT 0,
  last_sent_at  timestamptz,
  last_error    text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled ON push_subscriptions(enabled) WHERE enabled = true;

-- RLS: users can only access their own rows.
-- Both the ENABLE and the policies are required — enabling RLS without a
-- policy silently returns zero rows to the site.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own push subscriptions"
  ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_push_subscriptions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_push_subscriptions_timestamp();

-- Verify
SELECT 'push_subscriptions created' AS status,
       count(*)::text AS rows
FROM push_subscriptions;
