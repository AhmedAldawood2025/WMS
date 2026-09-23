/*
  # Allow Accountant to Edit Raw Material Purchase Orders

  Grants accountants the ability to update raw_material_purchase_orders and
  insert/update/delete raw_material_po_items, so they can edit POs generated
  from daily factory operations and manual POs.

  ## Changes
  1. raw_material_purchase_orders - new UPDATE policy for accountant
  2. raw_material_po_items - new INSERT, UPDATE, DELETE policies for accountant
*/

-- Allow accountants to update raw material POs (status, supplier, financials, notes)
CREATE POLICY "Accountants can update raw material POs"
  ON raw_material_purchase_orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  );

-- Allow accountants to insert new PO items (when editing a PO)
CREATE POLICY "Accountants can insert raw material PO items"
  ON raw_material_po_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  );

-- Allow accountants to update existing PO items (price, quantity)
CREATE POLICY "Accountants can update raw material PO items"
  ON raw_material_po_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  );

-- Allow accountants to delete PO items (when editing a PO)
CREATE POLICY "Accountants can delete raw material PO items"
  ON raw_material_po_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  );

-- Also allow accountants to create new raw material POs
CREATE POLICY "Accountants can create raw material POs"
  ON raw_material_purchase_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'accountant'
    )
  );
