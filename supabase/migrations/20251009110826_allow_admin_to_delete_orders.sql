/*
  # Allow Admin to Delete Orders

  ## Overview
  Adds DELETE policy for orders table to allow admins to completely remove orders from the system.

  ## Changes
  1. Create new DELETE policy that allows only admins to delete orders
  2. Uses auth.jwt() to check user role from JWT metadata

  ## Security
  - Only users with role='admin' can delete orders
  - Prevents data loss by restricting delete operations to admins only
  - Warehouse and factory managers can only cancel orders (via UPDATE), not delete them
*/

-- Create policy allowing only admins to delete orders
CREATE POLICY "Admins can delete orders"
  ON orders FOR DELETE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );
