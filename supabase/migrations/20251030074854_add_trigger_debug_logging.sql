/*
  # Add Trigger Debug Logging Table

  ## Purpose
  Create a debug log table to track trigger executions since RAISE NOTICE
  messages aren't visible from the Supabase client.

  ## Changes
  - Create trigger_debug_log table to store execution details
  - Update trigger to log all executions
  - This will help diagnose why stock isn't updating

  ## Security
  - Accessible to authenticated users for debugging
*/

-- Create debug log table
CREATE TABLE IF NOT EXISTS trigger_debug_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_name text NOT NULL,
  po_id uuid,
  po_number text,
  old_status text,
  new_status text,
  condition_met boolean,
  rows_updated integer,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trigger_debug_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view debug logs"
  ON trigger_debug_log FOR SELECT
  TO authenticated
  USING (true);

-- Update trigger to log to table
DROP TRIGGER IF EXISTS update_raw_material_stock_trigger ON raw_material_purchase_orders;
DROP FUNCTION IF EXISTS update_raw_material_stock_on_po_received();

CREATE OR REPLACE FUNCTION update_raw_material_stock_on_po_received()
RETURNS trigger AS $$
DECLARE
  updated_count integer := 0;
  condition_met boolean := false;
  error_msg text := null;
BEGIN
  -- Check condition
  condition_met := (NEW.status = 'received' AND COALESCE(OLD.status, '') != 'received');
  
  -- Log trigger execution
  INSERT INTO trigger_debug_log (trigger_name, po_id, po_number, old_status, new_status, condition_met)
  VALUES ('update_raw_material_stock', NEW.id, NEW.po_number, OLD.status, NEW.status, condition_met);
  
  IF condition_met THEN
    -- Update raw material stock
    UPDATE raw_materials rm
    SET 
      current_stock = rm.current_stock + (
        SELECT poi.quantity 
        FROM raw_material_po_items poi
        WHERE poi.po_id = NEW.id 
        AND poi.raw_material_id = rm.id
      ),
      updated_at = now()
    WHERE EXISTS (
      SELECT 1 
      FROM raw_material_po_items poi
      WHERE poi.po_id = NEW.id 
      AND poi.raw_material_id = rm.id
    );
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    -- Update log with row count
    UPDATE trigger_debug_log 
    SET rows_updated = updated_count
    WHERE po_id = NEW.id AND created_at = (
      SELECT MAX(created_at) FROM trigger_debug_log WHERE po_id = NEW.id
    );
    
    -- Set received timestamp
    NEW.received_at := now();
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    error_msg := SQLERRM;
    UPDATE trigger_debug_log 
    SET error_message = error_msg
    WHERE po_id = NEW.id AND created_at = (
      SELECT MAX(created_at) FROM trigger_debug_log WHERE po_id = NEW.id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER update_raw_material_stock_trigger
  BEFORE UPDATE ON raw_material_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_raw_material_stock_on_po_received();