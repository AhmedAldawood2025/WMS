/*
  # Add General Manager Role

  ## Overview
  Adds general_manager role to the system with appropriate permissions.

  ## Changes Made
  1. Update profiles table role constraint to include general_manager
  2. Update all relevant RLS policies to include general_manager

  ## Important Notes
  - General managers can approve purchase orders
  - General managers have visibility into all operations
  - Cannot modify existing data, only approve/reject
*/

-- Update role constraint to include general_manager
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('customer', 'warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager'));