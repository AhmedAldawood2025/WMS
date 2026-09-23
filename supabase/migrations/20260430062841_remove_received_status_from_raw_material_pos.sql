/*
  # Remove "received" status from raw_material_purchase_orders

  Updates the status CHECK constraint to only allow:
  pending, approved, rejected, on_hold

  Existing rows with status='received' are migrated to 'approved' first
  to avoid constraint violation.
*/

UPDATE raw_material_purchase_orders SET status = 'approved' WHERE status = 'received';

ALTER TABLE raw_material_purchase_orders
  DROP CONSTRAINT IF EXISTS raw_material_purchase_orders_status_check;

ALTER TABLE raw_material_purchase_orders
  ADD CONSTRAINT raw_material_purchase_orders_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'on_hold'));
