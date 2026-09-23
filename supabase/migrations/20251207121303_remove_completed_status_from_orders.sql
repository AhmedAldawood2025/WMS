/*
  # Remove completed status from orders

  1. Changes
    - Update any existing "completed" orders to "cancelled"
    - Remove "completed" from the check constraint
    - Keep only: pending, approved_by_manager, approved_by_accountant, cancelled

  2. Reasoning
    - Simplify order workflow
    - Orders are either pending, approved by manager, approved by accountant, or cancelled
    - Once approved by accountant, orders are moved to monthly summary and deleted
*/

-- First, update any existing "completed" orders to "cancelled"
UPDATE orders 
SET status = 'cancelled'
WHERE status = 'completed';

-- Drop the existing check constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add the updated check constraint without "completed"
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('pending', 'approved_by_manager', 'approved_by_accountant', 'cancelled'));
