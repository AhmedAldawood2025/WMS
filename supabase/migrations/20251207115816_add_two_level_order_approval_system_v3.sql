/*
  # Add Two-Level Order Approval System

  1. Changes
    - Add approval status tracking to orders table
    - Add manager_approved_at and accountant_approved_at timestamps
    - Add accountant_approved_by field
    - Migrate existing statuses to new workflow
    - Create function to move approved orders to monthly summary
    - Update RLS policies for accountant approval workflow

  2. Status Flow
    - pending: Default status when order is created
    - approved_by_manager: Manager has approved, waiting for accountant
    - approved_by_accountant: Accountant approved, moved to monthly summary
    - cancelled: Order was cancelled (kept for compatibility)
    - completed: Legacy status (kept for compatibility)

  3. Migration Strategy
    - Existing "approved" orders → "approved_by_manager" (sent to accountant for review)
    - Existing "pending" orders → stay as "pending"
    - Existing "completed" and "cancelled" → kept as is

  4. Security
    - Managers can approve their category orders (change status to approved_by_manager)
    - Accountants can approve orders (change status to approved_by_accountant)
    - Original orders can be deleted after moving to monthly summary
*/

-- First, drop the existing check constraint if it exists
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new columns to orders table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'manager_approved_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN manager_approved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'manager_approved_by'
  ) THEN
    ALTER TABLE orders ADD COLUMN manager_approved_by uuid REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'accountant_approved_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN accountant_approved_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'accountant_approved_by'
  ) THEN
    ALTER TABLE orders ADD COLUMN accountant_approved_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

-- Migrate existing "approved" orders to "approved_by_manager" 
-- These will show up for accountant review
UPDATE orders 
SET status = 'approved_by_manager',
    manager_approved_at = COALESCE(updated_at, created_at)
WHERE status = 'approved';

-- Add the check constraint with all valid statuses
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('pending', 'approved_by_manager', 'approved_by_accountant', 'cancelled', 'completed'));

-- Set default value for new orders
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

-- Add indexes for faster queries on status
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_manager_approved_at ON orders(manager_approved_at);
CREATE INDEX IF NOT EXISTS idx_orders_category_status ON orders(category, status);

-- Create function to bulk approve orders and move to monthly summary
CREATE OR REPLACE FUNCTION approve_orders_to_monthly_summary(
  order_ids uuid[],
  accountant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_rec RECORD;
  item_rec RECORD;
  summary_id uuid;
BEGIN
  -- Loop through each order
  FOR order_rec IN 
    SELECT o.*, b.name as branch_name
    FROM orders o
    JOIN branches b ON o.branch_id = b.id
    WHERE o.id = ANY(order_ids)
    AND o.status = 'approved_by_manager'
  LOOP
    -- Check if monthly summary exists for this branch and month
    SELECT id INTO summary_id
    FROM monthly_summaries
    WHERE branch_id = order_rec.branch_id
    AND category = order_rec.category
    AND month = DATE_TRUNC('month', order_rec.created_at)::date;

    -- Create monthly summary if it doesn't exist
    IF summary_id IS NULL THEN
      INSERT INTO monthly_summaries (branch_id, category, month)
      VALUES (order_rec.branch_id, order_rec.category, DATE_TRUNC('month', order_rec.created_at)::date)
      RETURNING id INTO summary_id;
    END IF;

    -- Add each order item to monthly summary items
    FOR item_rec IN
      SELECT oi.*, i.name as item_name
      FROM order_items oi
      JOIN items i ON oi.item_id = i.id
      WHERE oi.order_id = order_rec.id
    LOOP
      -- Check if item already exists in monthly summary
      IF EXISTS (
        SELECT 1 FROM monthly_summary_items
        WHERE monthly_summary_id = summary_id
        AND item_id = item_rec.item_id
      ) THEN
        -- Update existing item
        UPDATE monthly_summary_items
        SET quantity = quantity + item_rec.quantity
        WHERE monthly_summary_id = summary_id
        AND item_id = item_rec.item_id;
      ELSE
        -- Insert new item
        INSERT INTO monthly_summary_items (monthly_summary_id, item_id, quantity)
        VALUES (summary_id, item_rec.item_id, item_rec.quantity);
      END IF;
    END LOOP;

    -- Mark order as approved by accountant (temporary, will be deleted)
    UPDATE orders
    SET status = 'approved_by_accountant',
        accountant_approved_at = NOW(),
        accountant_approved_by = accountant_id
    WHERE id = order_rec.id;

    -- Delete order items
    DELETE FROM order_items WHERE order_id = order_rec.id;

    -- Delete the order
    DELETE FROM orders WHERE id = order_rec.id;
  END LOOP;
END;
$$;

-- Update RLS policies for orders table

-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Managers can update orders" ON orders;
DROP POLICY IF EXISTS "Managers can update their category orders" ON orders;
DROP POLICY IF EXISTS "Managers can view orders" ON orders;
DROP POLICY IF EXISTS "Managers can view their category orders" ON orders;

-- Managers can view pending orders in their category
CREATE POLICY "Managers can view pending orders in their category"
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
      AND orders.status = 'pending'
    )
  );

-- Managers can approve and update orders in their category (including changing branch)
CREATE POLICY "Managers can approve orders in their category"
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
      AND orders.status = 'pending'
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

-- Accountants can view orders approved by managers
CREATE POLICY "Accountants can view manager-approved orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'accountant'
      AND orders.status = 'approved_by_manager'
    )
  );

-- Accountants can update orders (for approval)
CREATE POLICY "Accountants can approve orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'accountant'
      AND orders.status = 'approved_by_manager'
    )
  );

-- Accountants can delete orders (after moving to monthly summary or rejecting)
CREATE POLICY "Accountants can delete approved orders"
  ON orders FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'accountant'
    )
  );

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION approve_orders_to_monthly_summary TO authenticated;
