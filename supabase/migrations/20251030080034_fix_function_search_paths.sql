/*
  # Fix Function Search Paths

  ## Issue
  Functions have role-mutable search_path which is a security vulnerability.
  An attacker could create malicious objects in a schema earlier in the search path.

  ## Solution
  Set search_path to a safe, immutable value for all functions.
  Use fully qualified names (schema.table) or set search_path to empty.

  ## Security Impact
  - Prevents search path hijacking attacks
  - Ensures functions reference correct schema objects
  - Required for SECURITY DEFINER functions

  ## Changes
  Set search_path for all functions to prevent attacks.
*/

-- Update all functions to have secure search_path
ALTER FUNCTION get_warehouse_low_stock_items() SET search_path = public, pg_temp;
ALTER FUNCTION generate_order_number(text) SET search_path = public, pg_temp;
ALTER FUNCTION set_order_number() SET search_path = public, pg_temp;
ALTER FUNCTION generate_warehouse_po_number() SET search_path = public, pg_temp;
ALTER FUNCTION set_warehouse_po_number() SET search_path = public, pg_temp;
ALTER FUNCTION generate_raw_material_po_number() SET search_path = public, pg_temp;
ALTER FUNCTION set_raw_material_po_number() SET search_path = public, pg_temp;
ALTER FUNCTION generate_batch_number() SET search_path = public, pg_temp;
ALTER FUNCTION set_batch_number() SET search_path = public, pg_temp;
ALTER FUNCTION get_factory_low_stock_items() SET search_path = public, pg_temp;
ALTER FUNCTION get_raw_material_low_stock_items() SET search_path = public, pg_temp;
ALTER FUNCTION update_stock_on_production() SET search_path = public, pg_temp;
ALTER FUNCTION deduct_warehouse_stock_on_order_approved() SET search_path = public, pg_temp;
ALTER FUNCTION deduct_factory_stock_on_order_approved() SET search_path = public, pg_temp;
ALTER FUNCTION initialize_stock_for_new_item() SET search_path = public, pg_temp;
ALTER FUNCTION trigger_cleanup_old_orders() SET search_path = public, pg_temp;
ALTER FUNCTION cleanup_old_orders() SET search_path = public, pg_temp;
ALTER FUNCTION update_warehouse_stock_on_po_received() SET search_path = public, pg_temp;
ALTER FUNCTION update_raw_material_stock_on_po_received() SET search_path = public, pg_temp;
ALTER FUNCTION handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION update_updated_at_column() SET search_path = public, pg_temp;