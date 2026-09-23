/*
  # Allow Admin to Mark Orders as Completed
  
  1. Changes
    - Add RLS policy for admins to update order status to completed
    - Admins can update any order to mark it as completed
  
  2. Security
    - Only users with admin role can update orders to completed status
    - Admins have full control over order status management
*/

-- Create policy for admins to update orders (including marking as completed)
CREATE POLICY "Admins can update orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
