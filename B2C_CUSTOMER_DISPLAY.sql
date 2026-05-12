-- ════════════════════════════════════════════════════════════════════
-- Customer Display settings
-- ════════════════════════════════════════════════════════════════════
-- Adds the display_settings JSONB column to tenants which the new
-- /display page reads. Default values are filled in from the frontend,
-- so this is purely a schema-level addition with no seed data needed.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS display_settings JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Storage bucket for promo images (and any other public uploads).
-- If the bucket doesn't exist, create it as public so the image URLs
-- returned by getPublicUrl() actually work without auth headers.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'public-uploads') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('public-uploads', 'public-uploads', TRUE, 5242880);  -- 5 MB
  END IF;
END
$do$;

-- Allow any authenticated user to upload to public-uploads
-- (frontend already gates this to admin via the Settings page route)
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'objects' AND schemaname = 'storage'
       AND policyname = 'public-uploads insert auth'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "public-uploads insert auth" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'public-uploads')
    $sql$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'objects' AND schemaname = 'storage'
       AND policyname = 'public-uploads select all'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "public-uploads select all" ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'public-uploads')
    $sql$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'objects' AND schemaname = 'storage'
       AND policyname = 'public-uploads delete auth'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "public-uploads delete auth" ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'public-uploads')
    $sql$;
  END IF;
END
$do$;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT 'display_settings column' AS section,
       EXISTS(
         SELECT 1 FROM information_schema.columns
          WHERE table_name='tenants' AND column_name='display_settings'
       )::TEXT AS ok
UNION ALL
SELECT 'public-uploads bucket',
       EXISTS(SELECT 1 FROM storage.buckets WHERE id='public-uploads')::TEXT;
