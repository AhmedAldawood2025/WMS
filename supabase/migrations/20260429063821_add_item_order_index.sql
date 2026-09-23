/*
  # Add order_index to items table

  1. Changes
    - Add order_index (integer) to items to control display order
    - Populate existing items with sequential order_index values
    - Index for fast ordering queries

  2. Notes
    - order_index is per-category (warehouse items ordered separately from factory items)
    - Lower order_index = appears first in the list
*/

ALTER TABLE items ADD COLUMN IF NOT EXISTS order_index integer DEFAULT 0;

-- Set initial order_index based on current serial order per category
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY category ORDER BY serial) AS rn
  FROM items
)
UPDATE items SET order_index = ranked.rn
FROM ranked WHERE items.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_items_category_order ON items(category, order_index);
