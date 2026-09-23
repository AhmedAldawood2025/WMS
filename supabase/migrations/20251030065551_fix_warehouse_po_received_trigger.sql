/*
  # Fix Warehouse PO Received Trigger

  ## Issue
  Similar to raw material POs, the warehouse PO received trigger
  needs improved status comparison logic.

  ## Changes
  - Improved status comparison to handle NULL values
  - Ensure trigger properly detects status change from any non-received status to received
  - Added better logging for debugging

  ## Testing
  After applying this migration, marking a warehouse PO as "received"
  should automatically update the warehouse stock levels.
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_warehouse_stock_trigger ON warehouse_purchase_orders;
DROP FUNCTION IF EXISTS update_warehouse_stock_on_po_received();

-- Recreate the function with improved logic
CREATE OR REPLACE FUNCTION update_warehouse_stock_on_po_received()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes TO received (from any other status)
  IF NEW.status = 'received' AND COALESCE(OLD.status, '') != 'received' THEN
    -- Update stock for each item in the PO
    INSERT INTO warehouse_stock (item_id, current_stock_purchase_units, current_stock_sale_units, updated_at)
    SELECT 
      wpi.item_id,
      wpi.quantity,
      wpi.quantity * COALESCE(wu.purchase_to_sale_ratio, 1),
      now()
    FROM warehouse_po_items wpi
    LEFT JOIN warehouse_units wu ON wu.item_id = wpi.item_id
    WHERE wpi.po_id = NEW.id
    ON CONFLICT (item_id) 
    DO UPDATE SET
      current_stock_purchase_units = warehouse_stock.current_stock_purchase_units + EXCLUDED.current_stock_purchase_units,
      current_stock_sale_units = warehouse_stock.current_stock_sale_units + EXCLUDED.current_stock_sale_units,
      updated_at = now();
    
    -- Set received timestamp
    NEW.received_at := now();
    
    RAISE NOTICE 'Updated warehouse stock for PO: %', NEW.po_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER update_warehouse_stock_trigger
  BEFORE UPDATE ON warehouse_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_warehouse_stock_on_po_received();