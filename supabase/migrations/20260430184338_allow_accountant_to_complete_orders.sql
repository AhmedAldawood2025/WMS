/*
  # Allow accountants to mark orders as completed

  Adds an UPDATE RLS policy so users with role 'accountant' can update
  orders (specifically to set status = 'completed').
*/

CREATE POLICY "Accountants can update orders"
  ON orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'accountant'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'accountant'
    )
  );
