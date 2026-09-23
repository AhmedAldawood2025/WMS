/*
  # Fix Raw Material PO Received Trigger

  ## Issue
  The trigger for updating raw material stock when PO is marked as received
  was not working properly due to status comparison logic.

  ## Changes
  - Improved status comparison to handle NULL values
  - Ensure trigger properly detects status change from any non-received status to received
  - Added better logging for debugging

  ## Testing
  After applying this migration, marking a raw material PO as "received"
  should automatically update the raw material stock levels.
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_raw_material_stock_trigger ON raw_material_purchase_orders;
DROP FUNCTION IF EXISTS update_raw_material_stock_on_po_received();

-- Recreate the function with improved logic
CREATE OR REPLACE FUNCTION update_raw_material_stock_on_po_received()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes TO received (from any other status)
  IF NEW.status = 'received' AND COALESCE(OLD.status, '') != 'received' THEN
    -- Update raw material stock by adding the quantities from PO items
    UPDATE raw_materials rm
    SET 
      current_stock = rm.current_stock + rmpi.quantity,
      updated_at = now()
    FROM raw_material_po_items rmpi
    WHERE rmpi.po_id = NEW.id
      AND rmpi.raw_material_id = rm.id;
    
    -- Set received timestamp
    NEW.received_at := now();
    
    RAISE NOTICE 'Updated raw material stock for PO: %', NEW.po_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER update_raw_material_stock_trigger
  BEFORE UPDATE ON raw_material_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_raw_material_stock_on_po_received();
