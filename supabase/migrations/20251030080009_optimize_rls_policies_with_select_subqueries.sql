/*
  # Optimize RLS Policies with SELECT Subqueries

  ## Issue
  RLS policies that directly call auth.uid() or auth.jwt() are evaluated for each row,
  causing significant performance degradation at scale.

  ## Solution
  Wrap auth function calls in SELECT subqueries so they're evaluated once per query
  instead of once per row.

  ## Performance Impact
  - Reduces CPU usage significantly
  - Improves query response times
  - Better scalability for large datasets

  ## Changes
  Recreate all RLS policies with optimized auth function calls:
  - Replace `auth.uid()` with `(select auth.uid())`
  - Replace `auth.jwt()->'user_metadata'->>'role'` with `(select auth.jwt()->'user_metadata'->>'role')`
*/

-- Drop all existing policies
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

CREATE POLICY "Admins can update profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Branches policies
CREATE POLICY "Everyone can view branches"
  ON branches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert branches"
  ON branches FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

CREATE POLICY "Admins can update branches"
  ON branches FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Items policies
CREATE POLICY "Everyone can view items"
  ON items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert items"
  ON items FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

CREATE POLICY "Admins can update items"
  ON items FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Orders policies
CREATE POLICY "Users can view orders"
  ON orders FOR SELECT
  TO authenticated
  USING (
    (select (auth.jwt()->'user_metadata'->>'role')) IN ('customer', 'warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager')
    AND (
      customer_id = (select auth.uid())
      OR (select (auth.jwt()->'user_metadata'->>'role')) IN ('accountant', 'admin', 'general_manager')
      OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'warehouse_manager' AND category = 'warehouse')
      OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager' AND category = 'factory')
    )
  );

CREATE POLICY "Customers can insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    (select (auth.jwt()->'user_metadata'->>'role')) = 'customer'
    AND customer_id = (select auth.uid())
  );

CREATE POLICY "Managers can update orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (
    (select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'factory_manager', 'admin')
    AND (
      (select (auth.jwt()->'user_metadata'->>'role')) = 'admin'
      OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'warehouse_manager' AND category = 'warehouse')
      OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager' AND category = 'factory')
    )
  )
  WITH CHECK (
    (select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'factory_manager', 'admin')
  );

CREATE POLICY "Admins can delete orders"
  ON orders FOR DELETE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Order items policies
CREATE POLICY "Users can view order items"
  ON order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.id = order_items.order_id 
      AND (
        o.customer_id = (select auth.uid())
        OR (select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager')
      )
    )
  );

CREATE POLICY "Users can insert order items"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.id = order_items.order_id 
      AND (
        (o.customer_id = (select auth.uid()) AND (select (auth.jwt()->'user_metadata'->>'role')) = 'customer')
        OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'warehouse_manager' AND o.category = 'warehouse')
        OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager' AND o.category = 'factory')
        OR (select (auth.jwt()->'user_metadata'->>'role')) = 'admin'
      )
    )
  );

CREATE POLICY "Managers can update order items"
  ON order_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.id = order_items.order_id 
      AND (
        (select (auth.jwt()->'user_metadata'->>'role')) = 'admin'
        OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'warehouse_manager' AND o.category = 'warehouse')
        OR ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager' AND o.category = 'factory')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders o 
      WHERE o.id = order_items.order_id 
      AND (select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'factory_manager', 'admin')
    )
  );

-- Suppliers policies
CREATE POLICY "Managers can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Admins can manage suppliers"
  ON suppliers FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Raw materials policies
CREATE POLICY "Managers can view raw materials"
  ON raw_materials FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Admins can manage raw materials"
  ON raw_materials FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

CREATE POLICY "Factory managers can update raw materials"
  ON raw_materials FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'factory_manager');

-- Warehouse units policies
CREATE POLICY "Managers can view warehouse units"
  ON warehouse_units FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Admins can manage warehouse units"
  ON warehouse_units FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin')
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) = 'admin');

-- Raw material purchase orders policies
CREATE POLICY "Factory managers can view raw material POs"
  ON raw_material_purchase_orders FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can create raw material POs"
  ON raw_material_purchase_orders FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

CREATE POLICY "Managers can update raw material POs"
  ON raw_material_purchase_orders FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin', 'general_manager'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin', 'general_manager'));

-- Raw material PO items policies
CREATE POLICY "Managers can view raw material PO items"
  ON raw_material_po_items FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can manage raw material PO items"
  ON raw_material_po_items FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

-- Warehouse purchase orders policies
CREATE POLICY "Warehouse managers can view warehouse POs"
  ON warehouse_purchase_orders FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Warehouse managers can create warehouse POs"
  ON warehouse_purchase_orders FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin'));

CREATE POLICY "Managers can update warehouse POs"
  ON warehouse_purchase_orders FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin', 'general_manager'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin', 'general_manager'));

-- Warehouse PO items policies
CREATE POLICY "Managers can view warehouse PO items"
  ON warehouse_po_items FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Warehouse managers can manage warehouse PO items"
  ON warehouse_po_items FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin'));

-- Production batches policies
CREATE POLICY "Managers can view production batches"
  ON production_batches FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can manage production batches"
  ON production_batches FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

-- Production inputs policies
CREATE POLICY "Managers can view production inputs"
  ON production_inputs FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can manage production inputs"
  ON production_inputs FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

-- Production outputs policies
CREATE POLICY "Managers can view production outputs"
  ON production_outputs FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can manage production outputs"
  ON production_outputs FOR ALL
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

-- Warehouse stock policies
CREATE POLICY "Managers can view warehouse stock"
  ON warehouse_stock FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Warehouse managers can update warehouse stock"
  ON warehouse_stock FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('warehouse_manager', 'admin'));

CREATE POLICY "System can insert warehouse stock"
  ON warehouse_stock FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Factory stock policies
CREATE POLICY "Managers can view factory stock"
  ON factory_stock FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Factory managers can update factory stock"
  ON factory_stock FOR UPDATE
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'))
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'admin'));

CREATE POLICY "System can insert factory stock"
  ON factory_stock FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Stock adjustments policies
CREATE POLICY "Authenticated users can view stock adjustments"
  ON stock_adjustments FOR SELECT
  TO authenticated
  USING ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'accountant', 'admin', 'general_manager'));

CREATE POLICY "Managers can create stock adjustments"
  ON stock_adjustments FOR INSERT
  TO authenticated
  WITH CHECK ((select (auth.jwt()->'user_metadata'->>'role')) IN ('factory_manager', 'warehouse_manager', 'admin'));