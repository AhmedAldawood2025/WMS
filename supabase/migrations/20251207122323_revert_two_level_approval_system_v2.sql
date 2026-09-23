/*
  # Revert Two-Level Order Approval System (v2)
  
  1. Changes
    - Remove approval tracking columns (manager_approved_at, accountant_approved_at, etc.)
    - Revert order statuses back to original workflow
    - Remove approve_orders_to_monthly_summary function
    - Restore original RLS policies
    - Restore original status check constraint
  
  2. Status Migration
    - approved_by_manager → approved
    - approved_by_accountant → approved
    - Keep pending, approved, completed, and cancelled
  
  3. Security
    - Restore original manager policies for viewing and updating orders
*/

-- Drop the function for bulk approving orders
DROP FUNCTION IF EXISTS approve_orders_to_monthly_summary(uuid[], uuid);

-- Drop the new policies
DROP POLICY IF EXISTS "Managers can view pending orders in their category" ON orders;
DROP POLICY IF EXISTS "Managers can approve orders in their category" ON orders;
DROP POLICY IF EXISTS "Accountants can view manager-approved orders" ON orders;
DROP POLICY IF EXISTS "Accountants can approve orders" ON orders;
DROP POLICY IF EXISTS "Accountants can delete approved orders" ON orders;

-- Drop the check constraint first
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Revert order statuses back to original (before adding constraint)
UPDATE orders 
SET status = 'approved'
WHERE status IN ('approved_by_manager', 'approved_by_accountant');

-- Add the restored check constraint with all original statuses
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('pending', 'approved', 'completed', 'cancelled'));

-- Set default value back to pending
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

-- Drop the new indexes
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_manager_approved_at;
DROP INDEX IF EXISTS idx_orders_category_status;

-- Remove the new columns
ALTER TABLE orders DROP COLUMN IF EXISTS manager_approved_at;
ALTER TABLE orders DROP COLUMN IF EXISTS manager_approved_by;
ALTER TABLE orders DROP COLUMN IF EXISTS accountant_approved_at;
ALTER TABLE orders DROP COLUMN IF EXISTS accountant_approved_by;

-- Restore original RLS policies for managers

-- Managers can view orders in their category
CREATE POLICY "Managers can view their category orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('factory_manager', 'warehouse_manager')
      AND (
        (profiles.role = 'factory_manager' AND orders.category = 'factory') OR
        (profiles.role = 'warehouse_manager' AND orders.category = 'warehouse')
      )
    )
  );

-- Managers can update orders in their category
CREATE POLICY "Managers can update their category orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('factory_manager', 'warehouse_manager')
      AND (
        (profiles.role = 'factory_manager' AND orders.category = 'factory') OR
        (profiles.role = 'warehouse_manager' AND orders.category = 'warehouse')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('factory_manager', 'warehouse_manager')
      AND (
        (profiles.role = 'factory_manager' AND orders.category = 'factory') OR
        (profiles.role = 'warehouse_manager' AND orders.category = 'warehouse')
      )
    )
  );
