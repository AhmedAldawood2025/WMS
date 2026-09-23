/*
  # Add "on_hold" status to raw_material_purchase_orders

  Replaces the existing status CHECK constraint to include 'on_hold'
  alongside pending, approved, rejected, received.
*/

ALTER TABLE raw_material_purchase_orders
  DROP CONSTRAINT IF EXISTS raw_material_purchase_orders_status_check;

ALTER TABLE raw_material_purchase_orders
  ADD CONSTRAINT raw_material_purchase_orders_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'on_hold', 'received'));
