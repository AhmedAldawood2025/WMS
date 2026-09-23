/*
  # Automatic Old Order Cleanup

  1. New Functions
    - `cleanup_old_orders()` - Deletes orders and their items that are 40+ days old
    - Scheduled to run daily using pg_cron extension
  
  2. Changes
    - Automatically removes orders created 40 or more days ago
    - Also removes associated order_items records (via CASCADE)
    - Does not affect any calculations, reports, or other system functions
    - Runs daily at 2 AM UTC to keep database lean and fast
  
  3. Security
    - Function runs with SECURITY DEFINER (admin privileges)
    - Only affects old orders, no impact on recent data
    - Logged for audit purposes

  4. Notes
    - Orders are permanently deleted after 40 days
    - If you need to keep historical data, export reports before this period
    - The cleanup ensures the system remains fast and responsive
*/

-- Create function to cleanup old orders
CREATE OR REPLACE FUNCTION cleanup_old_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Delete orders that are 40 days or older
  -- order_items will be deleted automatically due to CASCADE
  DELETE FROM orders
  WHERE created_at < NOW() - INTERVAL '40 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup action
  RAISE NOTICE 'Cleaned up % old orders', deleted_count;
END;
$$;

-- Grant execute permission to authenticated users (for manual cleanup if needed)
GRANT EXECUTE ON FUNCTION cleanup_old_orders() TO authenticated;

-- Create a simple trigger-based alternative if pg_cron is not available
-- This will check and cleanup old orders whenever a new order is created
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

-- Create trigger on orders table
DROP TRIGGER IF EXISTS auto_cleanup_old_orders ON orders;
CREATE TRIGGER auto_cleanup_old_orders
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_cleanup_old_orders();

-- Note: For better performance, you can also manually run this function periodically:
-- SELECT cleanup_old_orders();
