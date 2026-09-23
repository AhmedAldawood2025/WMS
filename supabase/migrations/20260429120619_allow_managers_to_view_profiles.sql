/*
  # Allow managers to view all profiles

  ## Problem
  The stock_adjustments history query joins profiles to show who made the adjustment.
  The profiles table only allows admins and self-view, so any join to another user's
  profile row fails RLS, causing the entire query to error and leaving factory items
  and raw materials empty (they share the same Promise.all).

  ## Fix
  Add a SELECT policy allowing all authenticated managers and staff to view profiles
  so that the adjusted_by_profile join works correctly.

  ## Security
  This is display-name lookup only — profiles only contain display_name, role, and
  branch info. No passwords or sensitive data.
*/

CREATE POLICY "Managers can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    (SELECT (auth.jwt()->'user_metadata'->>'role')) IN (
      'factory_manager', 'warehouse_manager', 'general_manager', 'accountant'
    )
  );
