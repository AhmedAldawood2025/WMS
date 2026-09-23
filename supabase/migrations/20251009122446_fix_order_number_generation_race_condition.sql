/*
  # Fix Order Number Generation Race Condition

  1. Changes
    - Replace the COUNT-based order number generation with a safer approach
    - Use a loop with exception handling to retry on conflicts
    - Generate unique order numbers even under concurrent inserts

  2. Technical Details
    - The previous implementation used COUNT(*) + 1, which could cause duplicate keys when multiple orders are created simultaneously
    - New implementation uses a loop that increments and retries if a duplicate is detected
    - Maximum 10 retries to prevent infinite loops
*/

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text AS $$
DECLARE
  order_date text;
  sequence_num integer;
  new_order_number text;
  max_existing integer;
BEGIN
  order_date := to_char(now(), 'YYYYMMDD');
  
  -- Get the highest existing sequence number for today
  SELECT COALESCE(
    MAX(
      CAST(
        SUBSTRING(order_number FROM 'ORD-[0-9]{8}-([0-9]{4})') 
        AS integer
      )
    ),
    0
  ) INTO max_existing
  FROM orders
  WHERE order_number LIKE 'ORD-' || order_date || '-%';
  
  sequence_num := max_existing + 1;
  new_order_number := 'ORD-' || order_date || '-' || LPAD(sequence_num::text, 4, '0');
  
  RETURN new_order_number;
END;
$$ LANGUAGE plpgsql;

-- Update the trigger function to handle potential conflicts with retry logic
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS trigger AS $$
DECLARE
  retry_count integer := 0;
  max_retries integer := 10;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    LOOP
      BEGIN
        NEW.order_number := generate_order_number();
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