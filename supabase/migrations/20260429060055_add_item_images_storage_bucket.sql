/*
  # Create item-images Storage Bucket and Policies

  1. Changes
    - Create item-images storage bucket (public)
    - Add RLS policies for storage:
      - Anyone can read item images (public read)
      - Only admins can upload/update/delete item images
*/

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  true,
  614400,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read access for item images
CREATE POLICY "Public can read item images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'item-images');

-- Only admins can upload item images
CREATE POLICY "Admins can upload item images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'item-images' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can update item images
CREATE POLICY "Admins can update item images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'item-images' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can delete item images
CREATE POLICY "Admins can delete item images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'item-images' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
