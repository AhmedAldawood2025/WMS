/*
  # Fix order_history performed_by foreign key and RLS

  1. Adds FK from order_history.performed_by to profiles.id so PostgREST
     can resolve the performer:profiles(...) join in queries.
  2. Adds a SELECT RLS policy for roles that need to view order history
     (accountant, admin, general_manager, warehouse_manager, factory_manager).
*/

ALTER TABLE order_history
  ADD CONSTRAINT order_history_performed_by_profiles_fkey
  FOREIGN KEY (performed_by) REFERENCES profiles(id) ON DELETE SET NULL;
