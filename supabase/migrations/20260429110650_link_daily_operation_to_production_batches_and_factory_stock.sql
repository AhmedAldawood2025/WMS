/*
  # Link Daily Operation to Production Batches and Factory Stock

  1. Changes
    - production_batches: add `daily_operation_id` (nullable) to track which daily op created it
    - daily_production_entries: add `demand_qty` column to store auto-calculated demand from orders
    - factory_stock: ensure upsert works via unique constraint on item_id (already exists)
    - stock_adjustments: `reference_id` currently used for item/rm id; add explicit `item_id` and 
      `raw_material_id` columns for clarity (reference_id kept for backward compat)

  2. Notes
    - daily_operation_id = NULL means batch was created manually (legacy)
    - demand_qty is populated when the daily operation is submitted
*/

-- Add daily_operation_id to production_batches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'production_batches' AND column_name = 'daily_operation_id'
  ) THEN
    ALTER TABLE production_batches ADD COLUMN daily_operation_id uuid REFERENCES daily_factory_operations(id);
  END IF;
END $$;

-- Add demand_qty to daily_production_entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_production_entries' AND column_name = 'demand_qty'
  ) THEN
    ALTER TABLE daily_production_entries ADD COLUMN demand_qty numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add explicit item_id and raw_material_id to stock_adjustments (alongside reference_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'item_id'
  ) THEN
    ALTER TABLE stock_adjustments ADD COLUMN item_id uuid REFERENCES items(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_adjustments' AND column_name = 'raw_material_id'
  ) THEN
    ALTER TABLE stock_adjustments ADD COLUMN raw_material_id uuid REFERENCES raw_materials(id);
  END IF;
END $$;

-- Allow factory_manager to insert into production_batches (for daily op batch creation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'production_batches' AND policyname = 'Factory manager can insert production batches'
  ) THEN
    CREATE POLICY "Factory manager can insert production batches"
      ON production_batches FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('factory_manager', 'admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'production_inputs' AND policyname = 'Factory manager can insert production inputs'
  ) THEN
    CREATE POLICY "Factory manager can insert production inputs"
      ON production_inputs FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('factory_manager', 'admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'production_outputs' AND policyname = 'Factory manager can insert production outputs'
  ) THEN
    CREATE POLICY "Factory manager can insert production outputs"
      ON production_outputs FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('factory_manager', 'admin'))
      );
  END IF;
END $$;

-- RLS for stock_adjustments item_id/raw_material_id (existing policies cover adjustment_type check)
-- The existing RLS on stock_adjustments already covers factory_manager via adjustment_type
