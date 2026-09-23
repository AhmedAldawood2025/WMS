/*
  # Fix item deletion by adding ON DELETE CASCADE to all item foreign keys

  1. Problem
    - Deleting an item fails because related rows in several tables block the delete
    - These tables had no cascade rule: order_items, warehouse_po_items, production_outputs,
      daily_withdrawal_entries, daily_item_snapshots, daily_production_entries, stock_adjustments

  2. Changes
    - Drop and re-create each blocking foreign key with ON DELETE CASCADE
    - warehouse_units, warehouse_stock, factory_stock already had CASCADE and are left untouched
*/

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_item_id_fkey,
  ADD CONSTRAINT order_items_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE warehouse_po_items
  DROP CONSTRAINT IF EXISTS warehouse_po_items_item_id_fkey,
  ADD CONSTRAINT warehouse_po_items_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE production_outputs
  DROP CONSTRAINT IF EXISTS production_outputs_item_id_fkey,
  ADD CONSTRAINT production_outputs_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE stock_adjustments
  DROP CONSTRAINT IF EXISTS stock_adjustments_item_id_fkey,
  ADD CONSTRAINT stock_adjustments_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE daily_withdrawal_entries
  DROP CONSTRAINT IF EXISTS daily_withdrawal_entries_item_id_fkey,
  ADD CONSTRAINT daily_withdrawal_entries_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE daily_item_snapshots
  DROP CONSTRAINT IF EXISTS daily_item_snapshots_item_id_fkey,
  ADD CONSTRAINT daily_item_snapshots_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE daily_production_entries
  DROP CONSTRAINT IF EXISTS daily_production_entries_item_id_fkey,
  ADD CONSTRAINT daily_production_entries_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
