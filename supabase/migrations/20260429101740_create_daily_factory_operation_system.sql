/*
  # Daily Factory Operation System

  1. New Columns
    - raw_materials.supplier_id: links each raw material to its primary supplier

  2. New Tables
    - daily_factory_operations: one record per day, tracks the daily session
    - daily_raw_material_snapshots: opening stock snapshot when day starts
    - daily_item_snapshots: opening stock snapshot for factory items
    - daily_supply_entries: raw materials received today (each supplier row = one PO)
    - daily_process_entries: raw materials consumed in today's process
    - daily_production_entries: factory items produced/tracked today
    - daily_withdrawal_entries: withdrawals of raw materials or processed items
    - daily_employee_meal_entries: employee meals deducted from raw material stock

  3. Security
    - RLS enabled on all new tables
    - factory_manager can manage all daily operation data
    - accountant can read supply entries (as POs)
    - admin and general_manager can read all
*/

-- Add supplier_id to raw_materials
ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);

-- Daily operation header (one per date)
CREATE TABLE IF NOT EXISTS daily_factory_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(operation_date)
);

-- Opening snapshot for raw materials (taken when operation is first created)
CREATE TABLE IF NOT EXISTS daily_raw_material_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  opening_quantity numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Opening snapshot for factory items
CREATE TABLE IF NOT EXISTS daily_item_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Today's supply entries (raw materials received)
CREATE TABLE IF NOT EXISTS daily_supply_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  po_id uuid REFERENCES raw_material_purchase_orders(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Today's process entries (raw materials consumed)
CREATE TABLE IF NOT EXISTS daily_process_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Daily items production tracking
CREATE TABLE IF NOT EXISTS daily_production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  opening_stock numeric NOT NULL DEFAULT 0,
  production_qty numeric NOT NULL DEFAULT 0 CHECK (production_qty >= 0),
  frozen_qty numeric NOT NULL DEFAULT 0 CHECK (frozen_qty >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(operation_id, item_id)
);

-- Withdrawals (raw material or processed item)
CREATE TABLE IF NOT EXISTS daily_withdrawal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  entry_type text NOT NULL CHECK (entry_type IN ('raw_material', 'processed_item')),
  supplier_id uuid REFERENCES suppliers(id),
  raw_material_id uuid REFERENCES raw_materials(id),
  item_id uuid REFERENCES items(id),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  stock_deducted boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Employee meals
CREATE TABLE IF NOT EXISTS daily_employee_meal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES daily_factory_operations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id),
  raw_material_id uuid REFERENCES raw_materials(id),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  stock_deducted boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_ops_date ON daily_factory_operations(operation_date);
CREATE INDEX IF NOT EXISTS idx_daily_supply_op ON daily_supply_entries(operation_id);
CREATE INDEX IF NOT EXISTS idx_daily_process_op ON daily_process_entries(operation_id);
CREATE INDEX IF NOT EXISTS idx_daily_production_op ON daily_production_entries(operation_id);
CREATE INDEX IF NOT EXISTS idx_daily_withdrawal_op ON daily_withdrawal_entries(operation_id);
CREATE INDEX IF NOT EXISTS idx_daily_meal_op ON daily_employee_meal_entries(operation_id);

-- RLS
ALTER TABLE daily_factory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_raw_material_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_item_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_supply_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_process_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_production_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_withdrawal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_employee_meal_entries ENABLE ROW LEVEL SECURITY;

-- Helper function for role check
CREATE OR REPLACE FUNCTION is_factory_or_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('factory_manager', 'admin', 'general_manager', 'accountant')
  )
$$;

CREATE OR REPLACE FUNCTION is_factory_manager()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('factory_manager', 'admin')
  )
$$;

-- Policies for daily_factory_operations
CREATE POLICY "Factory roles can read daily operations"
  ON daily_factory_operations FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert daily operations"
  ON daily_factory_operations FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can update daily operations"
  ON daily_factory_operations FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());

-- Policies for snapshots
CREATE POLICY "Factory roles can read rm snapshots"
  ON daily_raw_material_snapshots FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert rm snapshots"
  ON daily_raw_material_snapshots FOR INSERT TO authenticated WITH CHECK (is_factory_manager());

CREATE POLICY "Factory roles can read item snapshots"
  ON daily_item_snapshots FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert item snapshots"
  ON daily_item_snapshots FOR INSERT TO authenticated WITH CHECK (is_factory_manager());

-- Policies for supply entries
CREATE POLICY "Factory roles can read supply entries"
  ON daily_supply_entries FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert supply entries"
  ON daily_supply_entries FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can update supply entries"
  ON daily_supply_entries FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can delete supply entries"
  ON daily_supply_entries FOR DELETE TO authenticated USING (is_factory_manager());

-- Policies for process entries
CREATE POLICY "Factory roles can read process entries"
  ON daily_process_entries FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert process entries"
  ON daily_process_entries FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can update process entries"
  ON daily_process_entries FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can delete process entries"
  ON daily_process_entries FOR DELETE TO authenticated USING (is_factory_manager());

-- Policies for production entries
CREATE POLICY "Factory roles can read production entries"
  ON daily_production_entries FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert production entries"
  ON daily_production_entries FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can update production entries"
  ON daily_production_entries FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());

-- Policies for withdrawals
CREATE POLICY "Factory roles can read withdrawals"
  ON daily_withdrawal_entries FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert withdrawals"
  ON daily_withdrawal_entries FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can delete withdrawals"
  ON daily_withdrawal_entries FOR DELETE TO authenticated USING (is_factory_manager());
CREATE POLICY "Factory manager can update withdrawals"
  ON daily_withdrawal_entries FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());

-- Policies for employee meals
CREATE POLICY "Factory roles can read employee meals"
  ON daily_employee_meal_entries FOR SELECT TO authenticated USING (is_factory_or_admin());
CREATE POLICY "Factory manager can insert employee meals"
  ON daily_employee_meal_entries FOR INSERT TO authenticated WITH CHECK (is_factory_manager());
CREATE POLICY "Factory manager can delete employee meals"
  ON daily_employee_meal_entries FOR DELETE TO authenticated USING (is_factory_manager());
CREATE POLICY "Factory manager can update employee meals"
  ON daily_employee_meal_entries FOR UPDATE TO authenticated USING (is_factory_manager()) WITH CHECK (is_factory_manager());
