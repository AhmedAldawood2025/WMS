/*
  # Fix Orders RLS Policy

  ## Overview
  Fixes infinite recursion in orders SELECT policy and INSERT policy by using JWT metadata instead of querying profiles table.

  ## Changes
  1. Drop existing SELECT and INSERT policies that cause recursion
  2. Create new policies using auth.jwt() metadata
  3. Allows managers, accountants, and admins to view all orders
  4. Customers can only view their own orders

  ## Important Notes
  - Uses auth.jwt() to avoid querying profiles table
  - Prevents infinite recursion
*/

-- Drop existing policies that cause infinite recursion
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
DROP POLICY IF EXISTS "Customers can insert orders" ON orders;

-- Create new SELECT policy without recursion
CREATE POLICY "Users can view orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'warehouse_manager', 'factory_manager', 'accountant')
  );

-- Create new INSERT policy without recursion
CREATE POLICY "Customers can insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
    AND (auth.jwt()->'user_metadata'->>'role') = 'customer'
  );