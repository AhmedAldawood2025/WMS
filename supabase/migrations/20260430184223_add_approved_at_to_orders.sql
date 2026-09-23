/*
  # Add approved_at column to orders and auto-set via trigger

  1. Changes
     - Adds `approved_at` (timestamptz, nullable) column to `orders`
     - Backfills `approved_at` from `order_history` for already-approved/completed orders
     - Adds trigger `set_approved_at_on_approve` that sets `approved_at = now()`
       when an order's status transitions to 'approved'

  2. Notes
     - The "order date" in all reporting is now `approved_at`, not `created_at`
     - Orders that were approved before this migration get their date backfilled
       from the order_history table (the earliest 'approved' event)
*/

-- 1. Add column
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- 2. Backfill from order_history for orders already approved or completed
UPDATE orders o
SET approved_at = (
  SELECT MIN(h.created_at)
  FROM order_history h
  WHERE h.order_id = o.id
    AND h.event_type = 'approved'
)
WHERE o.status IN ('approved', 'completed')
  AND o.approved_at IS NULL;

-- 3. Trigger function
CREATE OR REPLACE FUNCTION set_approved_at_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Attach trigger
DROP TRIGGER IF EXISTS trg_set_approved_at ON orders;
CREATE TRIGGER trg_set_approved_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_approved_at_on_approve();
