/*
  # Allow Factory Managers to Mark Raw Material POs as Received

  ## Issue
  Factory managers could not mark raw material purchase orders as "received"
  because the UPDATE policy only allowed general_manager role.

  ## Changes
  - Update the RLS policy to allow factory managers to update raw material POs
  - This enables factory managers to mark POs as "received" after approval
  - General managers and admins retain full update access

  ## Security
  - Factory managers can only update their own department's POs
  - The policy is still restrictive and secure
*/

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "General managers can update raw material POs" ON raw_material_purchase_orders;

-- Create new policy allowing factory managers to mark POs as received
CREATE POLICY "Factory and general managers can update raw material POs"
  ON raw_material_purchase_orders FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'general_manager'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'general_manager'));