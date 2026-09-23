/*
  # Fix Raw Material PO Received Trigger - Add Logging and Error Handling

  ## Issue
  The trigger exists and the SQL logic is correct, but it's not executing
  when updates come from the Supabase client. Adding comprehensive logging
  to diagnose the issue.

  ## Changes
  - Add detailed RAISE NOTICE statements to track trigger execution
  - Add error handling with RAISE WARNING for failures
  - Log OLD and NEW status values for debugging
  - Verify the UPDATE is actually executing

  ## Debugging
  This will help us see exactly what's happening when the trigger fires.
*/

-- Drop and recreate with detailed logging
DROP TRIGGER IF EXISTS update_raw_material_stock_trigger ON raw_material_purchase_orders;
DROP FUNCTION IF EXISTS update_raw_material_stock_on_po_received();

CREATE OR REPLACE FUNCTION update_raw_material_stock_on_po_received()
RETURNS trigger AS $$
DECLARE
  updated_count integer;
BEGIN
  RAISE NOTICE 'Trigger fired! OLD.status: %, NEW.status: %', OLD.status, NEW.status;
  
  -- Only process when status changes TO received (from any other status)
  IF NEW.status = 'received' AND COALESCE(OLD.status, '') != 'received' THEN
    RAISE NOTICE 'Condition met! Updating stock for PO: %', NEW.po_number;
    
    -- Update raw material stock by adding the quantities from PO items
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
    RAISE NOTICE 'Updated % raw material records', updated_count;
    
    -- Set received timestamp
    NEW.received_at := now();
    
    RAISE NOTICE 'Successfully updated raw material stock for PO: %', NEW.po_number;
  ELSE
    RAISE NOTICE 'Condition NOT met - no stock update';
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in trigger: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER update_raw_material_stock_trigger
  BEFORE UPDATE ON raw_material_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_raw_material_stock_on_po_received();