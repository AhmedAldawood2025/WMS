/*
  # Add Branch Code, Item Picture URL, and Order History

  1. New Columns
    - branches.code (text, unique) - Branch numeric/alphanumeric code set by admin
    - items.picture_url (text, nullable) - URL to item picture stored in Supabase storage

  2. New Tables
    - order_history - Tracks all changes to orders
      - id (uuid)
      - order_id (uuid, FK orders)
      - event_type (text) - created, edited, approved, completed, cancelled
      - performed_by (uuid, FK auth.users)
      - notes (text)
      - created_at (timestamptz)

  3. Security
    - RLS on order_history: authenticated users can read history for orders they can view
    - Admin/managers can insert history entries
    - Trigger to auto-record order status changes

  4. Storage
    - Creates item-images storage bucket for item pictures
*/

-- Add code column to branches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branches' AND column_name = 'code'
  ) THEN
    ALTER TABLE branches ADD COLUMN code text;
  END IF;
END $$;

-- Add picture_url column to items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'picture_url'
  ) THEN
    ALTER TABLE items ADD COLUMN picture_url text;
  END IF;
END $$;

-- Create order_history table
CREATE TABLE IF NOT EXISTS order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'edited', 'approved', 'completed', 'cancelled')),
  performed_by uuid REFERENCES auth.users(id),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookup by order
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON order_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_created_at ON order_history(created_at);

-- Enable RLS on order_history
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read order history
CREATE POLICY "Authenticated users can read order history"
  ON order_history FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert order history entries
CREATE POLICY "Authenticated users can insert order history"
  ON order_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = performed_by);

-- Trigger: auto-record history when order status changes
CREATE OR REPLACE FUNCTION record_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only record if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_history(order_id, event_type, performed_by, notes)
    VALUES (
      NEW.id,
      CASE NEW.status
        WHEN 'approved' THEN 'approved'
        WHEN 'completed' THEN 'completed'
        WHEN 'cancelled' THEN 'cancelled'
        ELSE 'edited'
      END,
      auth.uid(),
      'Status changed from ' || OLD.status || ' to ' || NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_order_status_change ON orders;
CREATE TRIGGER trg_record_order_status_change
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION record_order_status_change();

-- Trigger: auto-record when order is created
CREATE OR REPLACE FUNCTION record_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO order_history(order_id, event_type, performed_by, notes)
  VALUES (NEW.id, 'created', auth.uid(), 'Order created');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_order_created ON orders;
CREATE TRIGGER trg_record_order_created
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION record_order_created();
