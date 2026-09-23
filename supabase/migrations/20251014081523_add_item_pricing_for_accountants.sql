/*
  # Add Item Pricing for Accountant Management

  1. Changes
    - Add `unit_price` column to `items` table
    - This allows accountants to set prices for cost calculations in monthly reports
    - Price is per sale unit for warehouse items, per unit for factory items

  2. Default Value
    - Set default to 0 for existing items
*/

-- Add unit_price column to items table
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS unit_price numeric(10, 2) DEFAULT 0 NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN items.unit_price IS 'Unit price for cost calculations. For warehouse items: price per sale unit. For factory items: price per unit.';
