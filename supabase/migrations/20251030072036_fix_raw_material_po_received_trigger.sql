/*
  # Fix Raw Material PO Received Trigger - Correct SQL UPDATE

  ## Issue
  The previous trigger had a flawed UPDATE statement that didn't properly
  join the tables, causing the stock levels not to update.

  ## Changes
  - Rewrote the UPDATE statement to use a correlated subquery
  - This ensures each raw material gets updated with the correct quantity
  - The trigger now properly updates stock when PO is marked as received

  ## Technical Details
  The old query used FROM with a WHERE clause that didn't properly correlate.
  The new query uses WHERE EXISTS with a proper subquery to update each
  raw material individually.
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS update_raw_material_stock_trigger ON raw_material_purchase_orders;
DROP FUNCTION IF EXISTS update_raw_material_stock_on_po_received();

-- Recreate the function with corrected SQL
CREATE OR REPLACE FUNCTION update_raw_material_stock_on_po_received()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes TO received (from any other status)
  IF NEW.status = 'received' AND COALESCE(OLD.status, '') != 'received' THEN
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