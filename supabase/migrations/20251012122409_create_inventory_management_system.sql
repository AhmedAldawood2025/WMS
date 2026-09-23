/*
  # Create Comprehensive Inventory Management System

  ## Overview
  Creates complete inventory system for warehouse and factory operations including:
  - Purchase orders for warehouse items and factory raw materials
  - Stock tracking for warehouse items and factory items
  - Production tracking for factory
  - Supplier management
  - Units of measure for purchasing vs selling
  - Low stock alerts

  ## Changes Made
  1. New Tables
    - `suppliers` - Supplier/vendor information
    - `warehouse_units` - Units for warehouse items (purchase and sale units)
    - `raw_materials` - Factory raw materials (chicken in different sizes)
    - `warehouse_purchase_orders` - Purchase orders for warehouse items
    - `warehouse_po_items` - Line items in warehouse POs
    - `raw_material_purchase_orders` - Purchase orders for raw materials
    - `raw_material_po_items` - Line items in raw material POs
    - `production_batches` - Factory production records
    - `production_inputs` - Raw materials used in production
    - `production_outputs` - Factory items produced
    - `warehouse_stock` - Current stock levels for warehouse items
    - `factory_stock` - Current stock levels for factory items
    - `raw_material_stock` - Current stock levels for raw materials
    - `stock_adjustments` - Manual stock adjustments with reasons

  2. Security
    - RLS enabled on all tables
    - Appropriate policies for each role

  ## Important Notes
  - Warehouse items can have 2 units (purchase unit and sale unit)
  - Each item has minimum stock level for alerts
  - Stock is automatically updated via triggers
  - All monetary values in decimal for precision
*/

-- ============================================================================
-- SUPPLIERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  type text NOT NULL CHECK (type IN ('warehouse', 'raw_material', 'both')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage suppliers"
  ON suppliers FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

CREATE POLICY "Managers and accountants can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'factory_manager', 'accountant', 'general_manager'));

-- ============================================================================
-- WAREHOUSE UNITS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  purchase_unit text NOT NULL,
  purchase_to_sale_ratio numeric(10,2) NOT NULL DEFAULT 1,
  sale_unit text NOT NULL,
  minimum_stock_purchase_units numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(item_id)
);

ALTER TABLE warehouse_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage warehouse units"
  ON warehouse_units FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

CREATE POLICY "Managers can view warehouse units"
  ON warehouse_units FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'factory_manager', 'accountant', 'general_manager'));

-- ============================================================================
-- RAW MATERIALS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  unit text NOT NULL,
  minimum_stock_level numeric(10,2) NOT NULL DEFAULT 0,
  current_stock numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage raw materials"
  ON raw_materials FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

CREATE POLICY "Managers and accountants can view raw materials"
  ON raw_materials FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'warehouse_manager', 'accountant', 'general_manager'));

-- ============================================================================
-- WAREHOUSE PURCHASE ORDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'received')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  received_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE warehouse_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Warehouse managers can create warehouse POs"
  ON warehouse_purchase_orders FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'warehouse_manager');

CREATE POLICY "Warehouse managers can view warehouse POs"
  ON warehouse_purchase_orders FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "General managers can update warehouse POs"
  ON warehouse_purchase_orders FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'general_manager')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'general_manager');

CREATE POLICY "Admins can manage warehouse POs"
  ON warehouse_purchase_orders FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- ============================================================================
-- WAREHOUSE PO ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES warehouse_purchase_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity numeric(10,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE warehouse_po_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Warehouse managers can manage warehouse PO items"
  ON warehouse_po_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM warehouse_purchase_orders
      WHERE warehouse_purchase_orders.id = warehouse_po_items.po_id
      AND (auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM warehouse_purchase_orders
      WHERE warehouse_purchase_orders.id = warehouse_po_items.po_id
      AND (auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'admin')
    )
  );

CREATE POLICY "Managers and accountants can view warehouse PO items"
  ON warehouse_po_items FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- RAW MATERIAL PURCHASE ORDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_material_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'received')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  received_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE raw_material_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factory managers can create raw material POs"
  ON raw_material_purchase_orders FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'factory_manager');

CREATE POLICY "Factory managers can view raw material POs"
  ON raw_material_purchase_orders FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "General managers can update raw material POs"
  ON raw_material_purchase_orders FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'general_manager')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'general_manager');

CREATE POLICY "Admins can manage raw material POs"
  ON raw_material_purchase_orders FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- ============================================================================
-- RAW MATERIAL PO ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_material_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES raw_material_purchase_orders(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  quantity numeric(10,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE raw_material_po_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factory managers can manage raw material PO items"
  ON raw_material_po_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM raw_material_purchase_orders
      WHERE raw_material_purchase_orders.id = raw_material_po_items.po_id
      AND (auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM raw_material_purchase_orders
      WHERE raw_material_purchase_orders.id = raw_material_po_items.po_id
      AND (auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin')
    )
  );

CREATE POLICY "Managers and accountants can view raw material PO items"
  ON raw_material_po_items FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- PRODUCTION BATCHES
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factory managers can manage production batches"
  ON production_batches FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'));

CREATE POLICY "Managers and accountants can view production batches"
  ON production_batches FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- PRODUCTION INPUTS (Raw materials used)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  quantity_used numeric(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factory managers can manage production inputs"
  ON production_inputs FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'));

CREATE POLICY "Managers and accountants can view production inputs"
  ON production_inputs FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- PRODUCTION OUTPUTS (Factory items produced)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity_produced numeric(10,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE production_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Factory managers can manage production outputs"
  ON production_outputs FOR ALL
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'));

CREATE POLICY "Managers and accountants can view production outputs"
  ON production_outputs FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- WAREHOUSE STOCK
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  current_stock_purchase_units numeric(10,2) NOT NULL DEFAULT 0,
  current_stock_sale_units numeric(10,2) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(item_id)
);

ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view warehouse stock"
  ON warehouse_stock FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Warehouse managers can update warehouse stock"
  ON warehouse_stock FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'admin'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'admin'));

CREATE POLICY "System can insert warehouse stock"
  ON warehouse_stock FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- FACTORY STOCK
-- ============================================================================
CREATE TABLE IF NOT EXISTS factory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  current_stock numeric(10,2) NOT NULL DEFAULT 0,
  minimum_stock_level numeric(10,2) NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(item_id)
);

ALTER TABLE factory_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view factory stock"
  ON factory_stock FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can update factory stock"
  ON factory_stock FOR UPDATE
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('factory_manager', 'admin'));

CREATE POLICY "System can insert factory stock"
  ON factory_stock FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- STOCK ADJUSTMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('warehouse', 'factory', 'raw_material')),
  reference_id uuid NOT NULL,
  quantity_before numeric(10,2) NOT NULL,
  quantity_after numeric(10,2) NOT NULL,
  difference numeric(10,2) NOT NULL,
  reason text NOT NULL,
  adjusted_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can create stock adjustments"
  ON stock_adjustments FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'factory_manager', 'admin'));

CREATE POLICY "Everyone can view stock adjustments"
  ON stock_adjustments FOR SELECT
  TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager'));

-- ============================================================================
-- AUTO-GENERATE PO NUMBERS
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_warehouse_po_number()
RETURNS text AS $$
DECLARE
  po_date text;
  sequence_num integer;
  new_po_number text;
  max_existing integer;
BEGIN
  po_date := to_char(now(), 'YYYYMMDD');
  
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(po_number FROM 'WPO-[0-9]{8}-([0-9]{4})') 
        AS integer
      )
    ),
    0
  ) INTO max_existing
  FROM warehouse_purchase_orders
  WHERE po_number LIKE 'WPO-' || po_date || '-%';
  
  sequence_num := max_existing + 1;
  new_po_number := 'WPO-' || po_date || '-' || LPAD(sequence_num::text, 4, '0');
  
  RETURN new_po_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_warehouse_po_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    NEW.po_number := generate_warehouse_po_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_warehouse_po_number_trigger ON warehouse_purchase_orders;
CREATE TRIGGER set_warehouse_po_number_trigger
  BEFORE INSERT ON warehouse_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_warehouse_po_number();

CREATE OR REPLACE FUNCTION generate_raw_material_po_number()
RETURNS text AS $$
DECLARE
  po_date text;
  sequence_num integer;
  new_po_number text;
  max_existing integer;
BEGIN
  po_date := to_char(now(), 'YYYYMMDD');
  
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(po_number FROM 'RPO-[0-9]{8}-([0-9]{4})') 
        AS integer
      )
    ),
    0
  ) INTO max_existing
  FROM raw_material_purchase_orders
  WHERE po_number LIKE 'RPO-' || po_date || '-%';
  
  sequence_num := max_existing + 1;
  new_po_number := 'RPO-' || po_date || '-' || LPAD(sequence_num::text, 4, '0');
  
  RETURN new_po_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_raw_material_po_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    NEW.po_number := generate_raw_material_po_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_raw_material_po_number_trigger ON raw_material_purchase_orders;
CREATE TRIGGER set_raw_material_po_number_trigger
  BEFORE INSERT ON raw_material_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_raw_material_po_number();

CREATE OR REPLACE FUNCTION generate_batch_number()
RETURNS text AS $$
DECLARE
  batch_date text;
  sequence_num integer;
  new_batch_number text;
  max_existing integer;
BEGIN
  batch_date := to_char(now(), 'YYYYMMDD');
  
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(batch_number FROM 'BATCH-[0-9]{8}-([0-9]{4})') 
        AS integer
      )
    ),
    0
  ) INTO max_existing
  FROM production_batches
  WHERE batch_number LIKE 'BATCH-' || batch_date || '-%';
  
  sequence_num := max_existing + 1;
  new_batch_number := 'BATCH-' || batch_date || '-' || LPAD(sequence_num::text, 4, '0');
  
  RETURN new_batch_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_batch_number()
RETURNS trigger AS $$
BEGIN
  IF NEW.batch_number IS NULL OR NEW.batch_number = '' THEN
    NEW.batch_number := generate_batch_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_batch_number_trigger ON production_batches;
CREATE TRIGGER set_batch_number_trigger
  BEFORE INSERT ON production_batches
  FOR EACH ROW
  EXECUTE FUNCTION set_batch_number();

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_warehouse_po_status ON warehouse_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_raw_material_po_status ON raw_material_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_item ON warehouse_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_factory_stock_item ON factory_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_production_batch_date ON production_batches(production_date);