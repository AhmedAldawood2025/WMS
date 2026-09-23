/*
  # Add Stock Level Tracking to Items

  1. Changes
    - Add `stock_level_required` boolean column to items table (default false)
    - Add `stock_level` integer column to order_items table to store customer-reported stock levels
    - Both columns are nullable to maintain backward compatibility

  2. Details
    - `stock_level_required`: When true for factory items, customers must provide current stock level when ordering
    - `stock_level`: Stores the customer-reported stock level at time of ordering
    - Only applies to factory items where stock_level_required is true
*/

-- Add stock_level_required column to items table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'stock_level_required'
  ) THEN
    ALTER TABLE items ADD COLUMN stock_level_required boolean DEFAULT false;
  END IF;
END $$;

-- Add stock_level column to order_items table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_items' AND column_name = 'stock_level'
  ) THEN
    ALTER TABLE order_items ADD COLUMN stock_level integer;
  END IF;
END $$;

-- Update existing items to have stock_level_required = false (explicit default)
UPDATE items SET stock_level_required = false WHERE stock_level_required IS NULL;