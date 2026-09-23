/*
  # Update Order Number Generation with Category Prefix

  ## Overview
  Updates the order number generation to include category prefix:
  - W-YYYYMMDD-#### for warehouse orders
  - F-YYYYMMDD-#### for factory orders

  ## Changes Made
  1. Update generate_order_number function to accept category parameter
  2. Update set_order_number trigger to use the category from NEW record
  3. Format: [W|F]-YYYYMMDD-####

  ## Important Notes
  - Order numbers are now unique within each category
  - Warehouse and factory orders have independent numbering sequences
*/

-- Drop trigger first before dropping functions
DROP TRIGGER IF EXISTS set_order_number_trigger ON orders;

-- Drop existing functions
DROP FUNCTION IF EXISTS generate_order_number();
DROP FUNCTION IF EXISTS set_order_number() CASCADE;

-- Create new function that generates order numbers with category prefix
CREATE OR REPLACE FUNCTION generate_order_number(p_category text)
RETURNS text AS $$
DECLARE
  order_date text;
  sequence_num integer;
  new_order_number text;
  max_existing integer;
  prefix text;
BEGIN
  -- Set prefix based on category
  IF p_category = 'warehouse' THEN
    prefix := 'W';
  ELSIF p_category = 'factory' THEN
    prefix := 'F';
  ELSE
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  order_date := to_char(now(), 'YYYYMMDD');
  
  -- Get the highest existing sequence number for today and this category
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(order_number FROM '[WF]-[0-9]{8}-([0-9]{4})') 
        AS integer
      )
    ),
    0
  ) INTO max_existing
  FROM orders
  WHERE order_number LIKE prefix || '-' || order_date || '-%'
    AND category = p_category;
  
  sequence_num := max_existing + 1;
  new_order_number := prefix || '-' || order_date || '-' || LPAD(sequence_num::text, 4, '0');
  
  RETURN new_order_number;
END;
$$ LANGUAGE plpgsql;

-- Update the trigger function to use category
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS trigger AS $$
DECLARE
  retry_count integer := 0;
  max_retries integer := 10;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    LOOP
      BEGIN
        NEW.order_number := generate_order_number(NEW.category);
        EXIT; -- Success, exit loop
      EXCEPTION
        WHEN unique_violation THEN
          retry_count := retry_count + 1;
          IF retry_count >= max_retries THEN
            RAISE EXCEPTION 'Failed to generate unique order number after % attempts', max_retries;
          END IF;
          -- Wait a tiny bit and retry
          PERFORM pg_sleep(0.01);
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER set_order_number_trigger
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_order_number();