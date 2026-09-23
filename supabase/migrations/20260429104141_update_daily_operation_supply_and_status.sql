/*
  # Update Daily Factory Operation

  1. Changes
    - daily_factory_operations: add `status` column ('draft' | 'submitted'), default 'draft'
    - daily_supply_entries: add `total_price` column to store full-row total (qty × unit), replace unit_price usage
      - unit_price derived as total_price / quantity when quantity > 0

  2. Notes
    - Existing rows get status = 'draft'
    - unit_price kept for backward compat but total_price is the primary input
*/

-- Add status to daily_factory_operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_factory_operations' AND column_name = 'status'
  ) THEN
    ALTER TABLE daily_factory_operations ADD COLUMN status text NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'submitted'));
  END IF;
END $$;

-- Add total_price to daily_supply_entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_supply_entries' AND column_name = 'total_price'
  ) THEN
    ALTER TABLE daily_supply_entries ADD COLUMN total_price numeric NOT NULL DEFAULT 0 CHECK (total_price >= 0);
  END IF;
END $$;

-- Backfill total_price for existing rows
UPDATE daily_supply_entries
SET total_price = quantity * unit_price
WHERE total_price = 0 AND quantity > 0 AND unit_price > 0;
