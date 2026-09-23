/*
  # Remove Automatic Order Deletion

  1. Changes
    - Drop the auto_cleanup_old_orders trigger from orders table
    - Drop the trigger_cleanup_old_orders function
    - Drop the cleanup_old_orders function
    - Orders will no longer be automatically deleted

  2. Reasoning
    - Orders must be kept indefinitely for record-keeping
    - Only admin can manually delete selected orders
    - Factory/warehouse managers can cancel orders but not delete them
*/

-- Drop the auto-cleanup trigger
DROP TRIGGER IF EXISTS auto_cleanup_old_orders ON orders;

-- Drop the trigger function
DROP FUNCTION IF EXISTS trigger_cleanup_old_orders() CASCADE;

-- Drop the cleanup function
DROP FUNCTION IF EXISTS cleanup_old_orders() CASCADE;
