/*
  # Fix order deletion for admins

  1. Problems
    - orders DELETE policy checks auth.jwt() user_metadata for role, which may not be in sync
      with the profiles table. The working UPDATE policy uses profiles table instead.
    - order_items has no DELETE policy, so cascade deletes from orders are blocked by RLS.

  2. Changes
    - Drop and recreate orders DELETE policy to use profiles table (consistent with UPDATE policy)
    - Add DELETE policy on order_items for admins so cascade works
*/

-- Fix orders DELETE policy to use profiles table (same approach as UPDATE)
DROP POLICY IF EXISTS "Admins can delete orders" ON orders;

CREATE POLICY "Admins can delete orders"
  ON orders
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Allow cascade deletes on order_items when admin deletes an order
CREATE POLICY "Admins can delete order items"
  ON order_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
