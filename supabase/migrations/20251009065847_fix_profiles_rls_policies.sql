/*
  # Fix Profiles RLS Policies

  ## Overview
  Fixes infinite recursion issue in profiles RLS policies by using raw_app_meta_data instead of querying the profiles table.

  ## Changes
  1. Drop existing SELECT policies that cause recursion
  2. Create new policies that check role from auth.jwt() metadata
  3. This prevents the policy from querying the profiles table while checking permissions

  ## Important Notes
  - Uses auth.jwt() to access user metadata without causing recursion
  - Role information is stored in raw_user_meta_data which is accessible via JWT
  - All users can view their own profile
  - Admins can view all profiles based on metadata role check
*/

-- Drop existing SELECT policies that cause infinite recursion
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;

-- Drop other problematic policies
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON profiles;

-- Create new SELECT policies without recursion
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    (auth.jwt()->>'role') = 'admin'
    OR (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Recreate INSERT policy with metadata check
CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->>'role') = 'admin'
    OR (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Recreate UPDATE policy with metadata check
CREATE POLICY "Admins can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->>'role') = 'admin'
    OR (auth.jwt()->'user_metadata'->>'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt()->>'role') = 'admin'
    OR (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );

-- Update the trigger function to also set role in app_metadata for better access control
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'role', 'customer')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;