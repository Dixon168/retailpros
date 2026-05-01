-- Add missing columns to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS upc TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prompt_weight BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prompt_price BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_serial BOOLEAN DEFAULT false;

-- Add avg_cost to inventory
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS avg_cost DECIMAL(10,4) DEFAULT 0;

-- Create storage bucket for product images
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read + authenticated upload
CREATE POLICY IF NOT EXISTS "Public read product images"
  ON storage.objects FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY IF NOT EXISTS "Auth upload product images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');

SELECT 'Products patch done ✓' AS status;
