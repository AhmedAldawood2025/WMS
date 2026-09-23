/*
  # Fix Order Items RLS Policy

  ## Overview
  Fixes infinite recursion in order_items SELECT policy by using JWT metadata instead of querying profiles table.

  ## Changes
  1. Drop existing SELECT policy that causes recursion
  2. Create new policy using auth.jwt() metadata
  3. Allows managers, accountants, and admins to view all order items
  4. Customers can only view their own order items

  ## Important Notes
  - Uses auth.jwt() to avoid querying profiles table
  - Prevents infinite recursion
  - Still checks the orders table for customer ownership
*/

-- Drop existing policy that causes infinite recursion
DROP POLICY IF EXISTS "Users can view order items based on order access" ON order_items;

-- Create new SELECT policy without recursion
CREATE POLICY "Users can view order items based on order access"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND (
        orders.customer_id = auth.uid()
        OR (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'warehouse_manager', 'factory_manager', 'accountant')
      )
    )
  );