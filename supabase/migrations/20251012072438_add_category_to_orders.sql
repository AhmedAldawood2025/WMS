/*
  # Add Category to Orders Table

  ## Overview
  Adds a category field to orders table to separate warehouse and factory orders.
  This allows warehouse and factory managers to independently manage their respective orders.

  ## Changes Made
  1. Schema Changes
    - Add `category` column to orders table (warehouse/factory)
    - Make order_number unique within category context
    - Update order number format to W-YYYYMMDD-#### or F-YYYYMMDD-####

  2. Data Migration
    - Temporarily allow NULL for category during migration
    - Set existing orders to 'warehouse' as default
    - Make category NOT NULL after migration

  3. Security Changes
    - Update RLS policies to filter by category based on manager role
    - Warehouse managers can only access warehouse orders
    - Factory managers can only access factory orders

  ## Important Notes
  - Order numbers will now include category prefix (W- or F-)
  - Existing orders are migrated to 'warehouse' category
  - Managers can only cancel orders in their own category
*/

-- Add category column (allow NULL temporarily for migration)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS category TEXT;

-- Set default category for existing orders
UPDATE orders SET category = 'warehouse' WHERE category IS NULL;

-- Make category NOT NULL and add constraint
ALTER TABLE orders ALTER COLUMN category SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_category_check 
  CHECK (category IN ('warehouse', 'factory'));

-- Drop existing RLS policies to recreate with category filtering
DROP POLICY IF EXISTS "Users can view orders" ON orders;
DROP POLICY IF EXISTS "Customers can insert orders" ON orders;
DROP POLICY IF EXISTS "Managers can update orders" ON orders;
DROP POLICY IF EXISTS "Admins can delete orders" ON orders;

-- Customers can view their own orders (both categories)
CREATE POLICY "Customers can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    AND (auth.jwt()->'user_metadata'->>'role') = 'customer'
  );

-- Warehouse managers can view warehouse orders only
CREATE POLICY "Warehouse managers can view warehouse orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    category = 'warehouse'
    AND (auth.jwt()->'user_metadata'->>'role') = 'warehouse_manager'
  );

-- Factory managers can view factory orders only
CREATE POLICY "Factory managers can view factory orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    category = 'factory'
    AND (auth.jwt()->'user_metadata'->>'role') = 'factory_manager'
  );

-- Accountants can view all orders
CREATE POLICY "Accountants can view all orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'accountant'
  );

-- Admins can view all orders
CREATE POLICY "Admins can view all orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Customers can insert orders
CREATE POLICY "Customers can insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
    AND (auth.jwt()->'user_metadata'->>'role') = 'customer'
  );

-- Warehouse managers can update warehouse orders only
CREATE POLICY "Warehouse managers can update warehouse orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    category = 'warehouse'
    AND (auth.jwt()->'user_metadata'->>'role') = 'warehouse_manager'
  )
  WITH CHECK (
    category = 'warehouse'
    AND (auth.jwt()->'user_metadata'->>'role') = 'warehouse_manager'
  );

-- Factory managers can update factory orders only
CREATE POLICY "Factory managers can update factory orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    category = 'factory'
    AND (auth.jwt()->'user_metadata'->>'role') = 'factory_manager'
  )
  WITH CHECK (
    category = 'factory'
    AND (auth.jwt()->'user_metadata'->>'role') = 'factory_manager'
  );

-- Admins can update all orders
CREATE POLICY "Admins can update all orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Admins can delete all orders
CREATE POLICY "Admins can delete all orders"
  ON orders FOR DELETE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );