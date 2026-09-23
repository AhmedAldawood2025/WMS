/*
  # Fix item deletion: add DELETE policy and preserve order history

  1. Problem
    - No RLS DELETE policy existed on the items table, so all deletes were silently blocked
    - order_items had ON DELETE CASCADE which would wipe order history

  2. Changes
    - Add DELETE policy for admins on items table
    - Change order_items.item_id FK from CASCADE to SET NULL so old orders are preserved
    - Also SET NULL for warehouse_po_items to preserve purchase order history
*/

-- Allow admins to delete items
CREATE POLICY "Admins can delete items"
  ON items
  FOR DELETE
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
  );

-- Preserve order history: set item_id to NULL when item is deleted
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_item_id_fkey,
  ADD CONSTRAINT order_items_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;

-- Preserve PO history: set item_id to NULL when item is deleted
ALTER TABLE warehouse_po_items
  DROP CONSTRAINT IF EXISTS warehouse_po_items_item_id_fkey,
  ADD CONSTRAINT warehouse_po_items_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
