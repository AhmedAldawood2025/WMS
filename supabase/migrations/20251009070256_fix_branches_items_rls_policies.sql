/*
  # Fix Branches and Items RLS Policies

  ## Overview
  Fixes infinite recursion issue in branches and items RLS policies by using JWT metadata instead of querying the profiles table.

  ## Changes
  1. Drop existing policies that query profiles table
  2. Create new policies that check role from auth.jwt() metadata
  3. This prevents infinite recursion and allows admin to create branches and items

  ## Important Notes
  - Uses auth.jwt() to access user metadata without causing recursion
  - Role information is stored in raw_user_meta_data which is accessible via JWT
*/

-- Fix Branches Policies
DROP POLICY IF EXISTS "Admins can insert branches" ON branches;
DROP POLICY IF EXISTS "Admins can update branches" ON branches;

CREATE POLICY "Admins can insert branches"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins can update branches"
  ON branches FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Fix Items Policies
DROP POLICY IF EXISTS "Admins can insert items" ON items;
DROP POLICY IF EXISTS "Admins can update items" ON items;

CREATE POLICY "Admins can insert items"
  ON items FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins can update items"
  ON items FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Fix Orders Policies
DROP POLICY IF EXISTS "Admins can update orders" ON orders;

CREATE POLICY "Admins can update orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );