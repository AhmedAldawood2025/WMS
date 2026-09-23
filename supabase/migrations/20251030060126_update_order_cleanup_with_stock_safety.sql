/*
  # Update Order Cleanup with Stock Safety

  1. Changes
    - Enhanced cleanup_old_orders() function with additional safety checks
    - Only deletes orders that won't affect stock levels
    - Adds logging for transparency
  
  2. Safety Features
    - Stock is deducted when orders are APPROVED (via UPDATE trigger)
    - Cleanup only deletes old orders (40+ days)
    - By the time orders are 40 days old, stock has already been deducted
    - DELETE operations don't trigger stock UPDATE triggers
    - Additional check: only delete orders in final states (approved/rejected/cancelled/completed)
  
  3. Impact
    - Zero impact on stock levels
    - Orders are deleted long after stock adjustments were made
    - Maintains database performance without affecting data integrity
*/

-- Drop the old function
DROP FUNCTION IF EXISTS cleanup_old_orders() CASCADE;

-- Create enhanced function with safety checks
CREATE OR REPLACE FUNCTION cleanup_old_orders()
RETURNS TABLE(deleted_orders integer, deleted_items integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_count integer;
  item_count integer;
BEGIN
  -- Count items to be deleted (for logging)
  SELECT COUNT(*) INTO item_count
  FROM order_items oi
  INNER JOIN orders o ON o.id = oi.order_id
  WHERE o.created_at < NOW() - INTERVAL '40 days'
    AND o.status IN ('approved', 'rejected', 'cancelled', 'completed');
  
  -- Delete old orders that are in final states
  -- These orders have already had their stock deducted (if approved)
  -- or were never fulfilled (if rejected/cancelled)
  DELETE FROM orders
  WHERE created_at < NOW() - INTERVAL '40 days'
    AND status IN ('approved', 'rejected', 'cancelled', 'completed');
  
  GET DIAGNOSTICS order_count = ROW_COUNT;
  
  -- Return counts for logging
  deleted_orders := order_count;
  deleted_items := item_count;
  
  -- Log the cleanup action
  RAISE NOTICE 'Cleaned up % orders and % order items older than 40 days', order_count, item_count;
  
  RETURN NEXT;
END;
$$;

-- Update the trigger function to use the new signature
DROP FUNCTION IF EXISTS trigger_cleanup_old_orders() CASCADE;
CREATE OR REPLACE FUNCTION trigger_cleanup_old_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Run cleanup in background (only occasionally to avoid performance hit)
  -- Random 1% chance to run cleanup on each insert
  IF random() < 0.01 THEN
    PERFORM cleanup_old_orders();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS auto_cleanup_old_orders ON orders;
CREATE TRIGGER auto_cleanup_old_orders
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_cleanup_old_orders();

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_old_orders() TO authenticated;

-- Add a comment explaining the safety
COMMENT ON FUNCTION cleanup_old_orders() IS 
'Safely deletes orders older than 40 days. Stock levels are NOT affected because:
1. Stock is deducted when orders are APPROVED (via UPDATE trigger, not DELETE)
2. Orders being deleted are 40+ days old - stock was already deducted long ago
3. Only deletes orders in final states (approved/rejected/cancelled/completed)
4. DELETE operations do not trigger the stock deduction UPDATE triggers';
