/*
  # Add INSERT Policy for Order Items

  ## Overview
  Adds INSERT policy for order_items table to allow managers to add items to orders.

  ## Changes Made
  1. Security Changes
    - Add INSERT policy for customers to create order items for their own orders
    - Add INSERT policy for warehouse managers to add items to warehouse orders
    - Add INSERT policy for factory managers to add items to factory orders
    - Add INSERT policy for admins to add items to any order

  ## Important Notes
  - Managers can only add items to orders in their category
  - Customers can add items during order creation
  - Admins have full access
*/

-- Customers can insert order items for their own orders
CREATE POLICY "Customers can insert order items for own orders"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.customer_id = auth.uid()
      AND (auth.jwt()->'user_metadata'->>'role') = 'customer'
    )
  );

-- Warehouse managers can insert items to warehouse orders
CREATE POLICY "Warehouse managers can insert items to warehouse orders"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.category = 'warehouse'
      AND (auth.jwt()->'user_metadata'->>'role') = 'warehouse_manager'
    )
  );

-- Factory managers can insert items to factory orders
CREATE POLICY "Factory managers can insert items to factory orders"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = order_items.order_id
      AND orders.category = 'factory'
      AND (auth.jwt()->'user_metadata'->>'role') = 'factory_manager'
    )
  );

-- Admins can insert items to any order
CREATE POLICY "Admins can insert items to any order"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
  );