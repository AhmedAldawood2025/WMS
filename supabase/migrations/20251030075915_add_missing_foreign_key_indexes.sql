/*
  # Add Missing Foreign Key Indexes

  ## Purpose
  Add indexes for all unindexed foreign keys to improve query performance.
  Foreign key constraints benefit significantly from indexes on the referencing columns.

  ## Performance Impact
  - Improves JOIN performance
  - Speeds up foreign key constraint checks
  - Reduces query planning time
  - Critical for tables with many relationships

  ## Indexes Added
  All foreign key columns that don't have covering indexes will be indexed.
*/

-- Branches table
CREATE INDEX IF NOT EXISTS idx_branches_created_by ON branches(created_by);

-- Items table
CREATE INDEX IF NOT EXISTS idx_items_created_by ON items(created_by);

-- Production batches
CREATE INDEX IF NOT EXISTS idx_production_batches_created_by ON production_batches(created_by);

-- Production inputs
CREATE INDEX IF NOT EXISTS idx_production_inputs_batch_id ON production_inputs(batch_id);
CREATE INDEX IF NOT EXISTS idx_production_inputs_raw_material_id ON production_inputs(raw_material_id);

-- Production outputs
CREATE INDEX IF NOT EXISTS idx_production_outputs_batch_id ON production_outputs(batch_id);
CREATE INDEX IF NOT EXISTS idx_production_outputs_item_id ON production_outputs(item_id);

-- Raw material PO items
CREATE INDEX IF NOT EXISTS idx_raw_material_po_items_po_id ON raw_material_po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_po_items_raw_material_id ON raw_material_po_items(raw_material_id);

-- Raw material purchase orders
CREATE INDEX IF NOT EXISTS idx_raw_material_po_approved_by ON raw_material_purchase_orders(approved_by);
CREATE INDEX IF NOT EXISTS idx_raw_material_po_created_by ON raw_material_purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_raw_material_po_supplier_id ON raw_material_purchase_orders(supplier_id);

-- Stock adjustments
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_adjusted_by ON stock_adjustments(adjusted_by);

-- Warehouse PO items
CREATE INDEX IF NOT EXISTS idx_warehouse_po_items_item_id ON warehouse_po_items(item_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_po_items_po_id ON warehouse_po_items(po_id);

-- Warehouse purchase orders
CREATE INDEX IF NOT EXISTS idx_warehouse_po_approved_by ON warehouse_purchase_orders(approved_by);
CREATE INDEX IF NOT EXISTS idx_warehouse_po_created_by ON warehouse_purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_warehouse_po_supplier_id ON warehouse_purchase_orders(supplier_id);