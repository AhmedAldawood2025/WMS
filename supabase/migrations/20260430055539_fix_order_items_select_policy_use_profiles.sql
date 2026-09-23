/*
  # Fix order_items SELECT policy to use profiles table

  The existing SELECT policy on order_items checks auth.jwt() user_metadata for role,
  which can be out of sync with the profiles table. This causes the View Details modal
  to fail for warehouse/factory managers because their role is not found in JWT metadata.

  Replace it with a policy that reads from profiles table directly, consistent with
  other working policies in the system.
*/

DROP POLICY IF EXISTS "Users can view order items" ON order_items;

CREATE POLICY "Users can view order items"
  ON order_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
      AND (
        o.customer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
          AND p.role IN ('warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager')
        )
      )
    )
  );
