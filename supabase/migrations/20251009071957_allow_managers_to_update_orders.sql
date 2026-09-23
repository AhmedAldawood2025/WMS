/*
  # Allow Managers to Update Orders

  ## Overview
  Updates the orders UPDATE policy to allow warehouse managers and factory managers to update order status.

  ## Changes
  1. Drop existing UPDATE policy that only allows admins
  2. Create new policy allowing warehouse_manager, factory_manager, and admin to update orders
  3. This enables the workflow: pending -> approved -> completed

  ## Important Notes
  - Uses auth.jwt() to avoid querying profiles table and prevent recursion
  - Warehouse and factory managers can update any order
  - Once status is 'completed', the order is locked (enforced in UI)
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Admins can update orders" ON orders;

-- Create new policy allowing managers to update orders
CREATE POLICY "Managers can update orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'warehouse_manager', 'factory_manager')
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'warehouse_manager', 'factory_manager')
  );