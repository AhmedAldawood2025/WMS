/*
  # Create Low Stock Alert Functions

  1. New Functions
    - `get_warehouse_low_stock_items()` - Returns warehouse items below minimum stock
    - `get_factory_low_stock_items()` - Returns factory items below minimum stock
    - `get_raw_material_low_stock_items()` - Returns raw materials below minimum stock

  2. Purpose
    - Enable General Manager and Admin to quickly view items that need restocking
    - Support quick PO creation from alerts
*/

-- Function to get warehouse items with low stock
CREATE OR REPLACE FUNCTION get_warehouse_low_stock_items()
RETURNS TABLE (
  item_id uuid,
  current_stock_purchase_units numeric,
  item jsonb,
  warehouse_units jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ws.item_id,
    ws.current_stock_purchase_units,
    jsonb_build_object(
      'serial', i.serial,
      'name', i.name
    ) as item,
    jsonb_build_object(
      'purchase_unit', wu.purchase_unit,
      'sale_unit', wu.sale_unit,
      'minimum_stock_purchase_units', wu.minimum_stock_purchase_units
    ) as warehouse_units
  FROM warehouse_stock ws
  JOIN items i ON i.id = ws.item_id
  JOIN warehouse_units wu ON wu.item_id = ws.item_id
  WHERE ws.current_stock_purchase_units <= wu.minimum_stock_purchase_units
  ORDER BY i.serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get factory items with low stock
CREATE OR REPLACE FUNCTION get_factory_low_stock_items()
RETURNS TABLE (
  item_id uuid,
  current_stock numeric,
  minimum_stock_level numeric,
  item jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fs.item_id,
    fs.current_stock,
    fs.minimum_stock_level,
    jsonb_build_object(
      'serial', i.serial,
      'name', i.name
    ) as item
  FROM factory_stock fs
  JOIN items i ON i.id = fs.item_id
  WHERE fs.current_stock <= fs.minimum_stock_level
  ORDER BY i.serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get raw materials with low stock
CREATE OR REPLACE FUNCTION get_raw_material_low_stock_items()
RETURNS TABLE (
  id uuid,
  name text,
  unit text,
  current_stock numeric,
  minimum_stock_level numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rm.id,
    rm.name,
    rm.unit,
    rm.current_stock,
    rm.minimum_stock_level
  FROM raw_materials rm
  WHERE rm.current_stock <= rm.minimum_stock_level
  ORDER BY rm.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_warehouse_low_stock_items() TO authenticated;
GRANT EXECUTE ON FUNCTION get_factory_low_stock_items() TO authenticated;
GRANT EXECUTE ON FUNCTION get_raw_material_low_stock_items() TO authenticated;
