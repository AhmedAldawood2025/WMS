/*
  # Allow item_id to be nullable in order_items and warehouse_po_items

  1. Problem
    - order_items.item_id and warehouse_po_items.item_id are NOT NULL
    - ON DELETE SET NULL fails because the column rejects null values

  2. Changes
    - Drop NOT NULL constraint on order_items.item_id
    - Drop NOT NULL constraint on warehouse_po_items.item_id
    - This allows item deletion while preserving old order/PO records with item_id = NULL
*/

ALTER TABLE order_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE warehouse_po_items ALTER COLUMN item_id DROP NOT NULL;
