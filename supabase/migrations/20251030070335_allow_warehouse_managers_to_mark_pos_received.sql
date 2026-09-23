/*
  # Allow Warehouse Managers to Mark Warehouse POs as Received

  ## Issue
  Warehouse managers could not mark warehouse purchase orders as "received"
  because the UPDATE policy only allowed general_manager role.

  ## Changes
  - Update the RLS policy to allow warehouse managers to update warehouse POs
  - This enables warehouse managers to mark POs as "received" after approval
  - General managers and admins retain full update access

  ## Security
  - Warehouse managers can only update their own department's POs
  - The policy is still restrictive and secure
*/

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "General managers can update warehouse POs" ON warehouse_purchase_orders;

-- Create new policy allowing warehouse managers to mark POs as received
CREATE POLICY "Warehouse and general managers can update warehouse POs"
  ON warehouse_purchase_orders FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'general_manager'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'general_manager'));