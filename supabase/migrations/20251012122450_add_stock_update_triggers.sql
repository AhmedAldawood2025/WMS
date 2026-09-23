/*
  # Add Stock Update Triggers

  ## Overview
  Creates triggers to automatically update stock levels when:
  - Warehouse POs are received
  - Raw material POs are received
  - Production batches are created
  - Customer orders are approved

  ## Changes Made
  1. Triggers for warehouse stock updates
  2. Triggers for factory stock updates
  3. Triggers for raw material stock updates
  4. Automatic stock initialization

  ## Important Notes
  - Stock is updated only when status changes to appropriate state
  - Prevents duplicate stock updates
  - Maintains stock accuracy
*/

-- ============================================================================
-- UPDATE WAREHOUSE STOCK WHEN PO IS RECEIVED
-- ============================================================================
CREATE OR REPLACE FUNCTION update_warehouse_stock_on_po_received()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes from non-received to received
  IF OLD.status != 'received' AND NEW.status = 'received' THEN
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
    
    NEW.received_at := now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_warehouse_stock_trigger ON warehouse_purchase_orders;
CREATE TRIGGER update_warehouse_stock_trigger
  BEFORE UPDATE ON warehouse_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_warehouse_stock_on_po_received();

-- ============================================================================
-- UPDATE RAW MATERIAL STOCK WHEN PO IS RECEIVED
-- ============================================================================
CREATE OR REPLACE FUNCTION update_raw_material_stock_on_po_received()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes from non-received to received
  IF OLD.status != 'received' AND NEW.status = 'received' THEN
    -- Update raw material stock
    UPDATE raw_materials rm
    SET 
      current_stock = rm.current_stock + rmpi.quantity,
      updated_at = now()
    FROM raw_material_po_items rmpi
    WHERE rmpi.po_id = NEW.id
      AND rmpi.raw_material_id = rm.id;
    
    NEW.received_at := now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_raw_material_stock_trigger ON raw_material_purchase_orders;
CREATE TRIGGER update_raw_material_stock_trigger
  BEFORE UPDATE ON raw_material_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_raw_material_stock_on_po_received();

-- ============================================================================
-- UPDATE STOCK WHEN PRODUCTION BATCH IS CREATED
-- ============================================================================
CREATE OR REPLACE FUNCTION update_stock_on_production()
RETURNS trigger AS $$
BEGIN
  -- Deduct raw materials used
  UPDATE raw_materials rm
  SET 
    current_stock = rm.current_stock - pi.quantity_used,
    updated_at = now()
  FROM production_inputs pi
  WHERE pi.batch_id = NEW.id
    AND pi.raw_material_id = rm.id;
  
  -- Add factory items produced
  INSERT INTO factory_stock (item_id, current_stock, updated_at)
  SELECT 
    po.item_id,
    po.quantity_produced,
    now()
  FROM production_outputs po
  WHERE po.batch_id = NEW.id
  ON CONFLICT (item_id) 
  DO UPDATE SET
    current_stock = factory_stock.current_stock + EXCLUDED.current_stock,
    updated_at = now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stock_on_production_trigger ON production_batches;
CREATE TRIGGER update_stock_on_production_trigger
  AFTER INSERT ON production_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_on_production();

-- ============================================================================
-- DEDUCT WAREHOUSE STOCK WHEN ORDER IS APPROVED
-- ============================================================================
CREATE OR REPLACE FUNCTION deduct_warehouse_stock_on_order_approved()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes to approved
  IF OLD.status != 'approved' AND NEW.status = 'approved' AND NEW.category = 'warehouse' THEN
    -- Deduct stock for warehouse items
    UPDATE warehouse_stock ws
    SET 
      current_stock_sale_units = ws.current_stock_sale_units - oi.quantity,
      updated_at = now()
    FROM order_items oi
    INNER JOIN items i ON i.id = oi.item_id AND i.category = 'warehouse'
    WHERE oi.order_id = NEW.id
      AND ws.item_id = oi.item_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deduct_warehouse_stock_trigger ON orders;
CREATE TRIGGER deduct_warehouse_stock_trigger
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION deduct_warehouse_stock_on_order_approved();

-- ============================================================================
-- DEDUCT FACTORY STOCK WHEN ORDER IS APPROVED
-- ============================================================================
CREATE OR REPLACE FUNCTION deduct_factory_stock_on_order_approved()
RETURNS trigger AS $$
BEGIN
  -- Only process when status changes to approved
  IF OLD.status != 'approved' AND NEW.status = 'approved' AND NEW.category = 'factory' THEN
    -- Deduct stock for factory items
    UPDATE factory_stock fs
    SET 
      current_stock = fs.current_stock - oi.quantity,
      updated_at = now()
    FROM order_items oi
    INNER JOIN items i ON i.id = oi.item_id AND i.category = 'factory'
    WHERE oi.order_id = NEW.id
      AND fs.item_id = oi.item_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deduct_factory_stock_trigger ON orders;
CREATE TRIGGER deduct_factory_stock_trigger
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION deduct_factory_stock_on_order_approved();

-- ============================================================================
-- INITIALIZE STOCK RECORDS FOR NEW ITEMS
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_stock_for_new_item()
RETURNS trigger AS $$
BEGIN
  IF NEW.category = 'warehouse' THEN
    INSERT INTO warehouse_stock (item_id, current_stock_purchase_units, current_stock_sale_units)
    VALUES (NEW.id, 0, 0)
    ON CONFLICT (item_id) DO NOTHING;
  ELSIF NEW.category = 'factory' THEN
    INSERT INTO factory_stock (item_id, current_stock, minimum_stock_level)
    VALUES (NEW.id, 0, 0)
    ON CONFLICT (item_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_stock_trigger ON items;
CREATE TRIGGER initialize_stock_trigger
  AFTER INSERT ON items
  FOR EACH ROW
  EXECUTE FUNCTION initialize_stock_for_new_item();