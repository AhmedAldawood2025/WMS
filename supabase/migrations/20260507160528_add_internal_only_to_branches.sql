/*
  # Add internal_only flag to branches

  ## Summary
  Adds an `internal_only` boolean column to the `branches` table.
  When true, the branch is hidden from customers creating orders but
  remains visible to warehouse and factory managers.

  ## Changes
  - `branches.internal_only` (boolean, default false): marks a branch as
    internal-only, visible only to warehouse/factory managers.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branches' AND column_name = 'internal_only'
  ) THEN
    ALTER TABLE branches ADD COLUMN internal_only boolean NOT NULL DEFAULT false;
  END IF;
END $$;
