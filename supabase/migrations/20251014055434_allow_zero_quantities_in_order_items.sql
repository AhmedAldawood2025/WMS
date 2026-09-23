/*
  # Allow Zero Quantities in Order Items

  1. Changes
    - Remove the CHECK constraint that requires quantity > 0
    - Allow quantity >= 0 instead
    - This enables managers to set items to zero quantity
    - Also allows customers to submit orders with zero quantities for items where only stock_level is required

  2. Reasoning
    - Factory items with stock_level_required may have 0 quantity but a stock level value
    - Managers should be able to set quantities to 0 when editing orders
    - Zero quantity items will be filtered out in display and print views
*/

-- Drop the existing check constraint on order_items
ALTER TABLE order_items 
DROP CONSTRAINT IF EXISTS order_items_quantity_check;

-- Add new constraint allowing zero or positive quantities
ALTER TABLE order_items
ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 0);
