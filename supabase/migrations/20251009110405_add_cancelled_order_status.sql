/*
  # Add cancelled status to orders

  1. Changes
    - Add check constraint to orders table to allow 'cancelled' status
    - Update existing status field to support: 'pending', 'approved', 'completed', 'cancelled'
  
  2. Notes
    - This migration adds support for order cancellation
    - Cancelled orders can be filtered and displayed differently in the UI
*/

DO $$ 
BEGIN
  -- Drop existing constraint if any
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'orders_status_check' 
    AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT orders_status_check;
  END IF;

  -- Add new constraint with cancelled status
  ALTER TABLE orders ADD CONSTRAINT orders_status_check 
    CHECK (status IN ('pending', 'approved', 'completed', 'cancelled'));
END $$;
