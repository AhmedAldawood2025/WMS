/*
  # Add completed_at and archived flag to orders

  1. Changes
     - Adds `completed_at` (timestamptz, nullable) — set automatically when status
       transitions to 'completed' via trigger
     - Adds `archived` (boolean, default false) — set to true after 24 hours of being
       completed, moves order to the history view
     - Backfills `completed_at` for already-completed orders from order_history
     - Adds trigger `set_completed_at_on_complete` to auto-set completed_at

  2. Notes
     - Archived orders are hidden from the active Orders view
     - A scheduled edge function will flip `archived = true` once
       `completed_at + 24 hours <= now()`
*/

-- 1. Add columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- 2. Backfill completed_at from order_history for already-completed orders
UPDATE orders o
SET completed_at = (
  SELECT MIN(h.created_at)
  FROM order_history h
  WHERE h.order_id = o.id
    AND h.event_type = 'completed'
)
WHERE o.status = 'completed'
  AND o.completed_at IS NULL;

-- 3. Trigger function
CREATE OR REPLACE FUNCTION set_completed_at_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger (runs before UPDATE, after set_approved_at trigger)
DROP TRIGGER IF EXISTS trg_set_completed_at ON orders;
CREATE TRIGGER trg_set_completed_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_completed_at_on_complete();

-- 5. Index for efficient archive job queries
CREATE INDEX IF NOT EXISTS idx_orders_archived_completed_at
  ON orders (archived, completed_at)
  WHERE archived = false AND completed_at IS NOT NULL;
