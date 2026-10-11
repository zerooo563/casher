-- Shared product catalog — ACCOUNT-LESS temporary workspace for collaborative
-- data entry (no login, no per-user accounts).
--
-- Design:
--   * One fixed workspace tenant (see 20261011000000_shared_workspace.sql).
--   * The anon key (embedded in the published app link) may read/write ONLY rows
--     of that workspace. Anyone with the app link can push/pull products.
--   * publish_shared_product_catalog() UPSERTS row-by-row (no DELETE) so that
--     concurrent pushes from several devices never wipe each other.
--   * Rows whose SKU/barcode collide with a DIFFERENT row are skipped and
--     reported back instead of aborting the whole batch.
--   * TEMPORARY: when the data-entry phase ends, revoke anon writes
--     (or drop these policies) and keep the catalog read-only/offline.
--   * This schema intentionally contains no stock quantities, movements,
--     sales, or customer data.

-- Fixed workspace id shared by every device (public value, inside the app).
--   a1000000-0000-0000-0000-000000000001  (slug 'casher-dev')

CREATE TABLE IF NOT EXISTS public.shared_product_catalog (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_product_id TEXT NOT NULL CHECK (length(source_product_id) BETWEEN 1 AND 120),
  name_ar TEXT NOT NULL CHECK (length(btrim(name_ar)) BETWEEN 1 AND 200),
  name_en TEXT,
  sku TEXT NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 120),
  barcode TEXT,
  category_name TEXT,
  unit_name TEXT NOT NULL CHECK (length(btrim(unit_name)) BETWEEN 1 AND 80),
  unit_symbol TEXT NOT NULL CHECK (length(btrim(unit_symbol)) BETWEEN 1 AND 24),
  cost_price NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price NUMERIC(19,4) NOT NULL CHECK (selling_price >= 0),
  wholesale_price NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.17 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  min_stock NUMERIC(15,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_product_id),
  UNIQUE (tenant_id, sku)
);

CREATE UNIQUE INDEX IF NOT EXISTS shared_product_catalog_barcode_unique_idx
  ON public.shared_product_catalog (tenant_id, btrim(barcode))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
CREATE INDEX IF NOT EXISTS shared_product_catalog_tenant_name_idx
  ON public.shared_product_catalog (tenant_id, name_ar);

ALTER TABLE public.shared_product_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_product_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_product_catalog TO anon, authenticated;

-- Any client holding the app link (anon key) works only inside the workspace.
DROP POLICY IF EXISTS shared_product_catalog_read_tenant ON public.shared_product_catalog;
DROP POLICY IF EXISTS shared_product_catalog_workspace ON public.shared_product_catalog;
CREATE POLICY shared_product_catalog_workspace
  ON public.shared_product_catalog
  FOR ALL TO anon, authenticated
  USING (tenant_id = 'a1000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (tenant_id = 'a1000000-0000-0000-0000-000000000001'::uuid);

-- Product images are isolated in a public bucket. No private inventory,
-- movement, sales, or customer documents are ever stored in this bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shared-product-images',
  'shared-product-images',
  true,
  500000,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 500000,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Workspace-scoped anon image upload (replaces the old owner-only policies).
DROP POLICY IF EXISTS shared_product_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS shared_product_images_owner_update ON storage.objects;
DROP POLICY IF EXISTS shared_product_images_owner_delete ON storage.objects;
DROP POLICY IF EXISTS shared_product_images_workspace_insert ON storage.objects;
CREATE POLICY shared_product_images_workspace_insert
  ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'shared-product-images'
    AND (storage.foldername(name))[1] = 'a1000000-0000-0000-0000-000000000001'
  );
DROP POLICY IF EXISTS shared_product_images_workspace_update ON storage.objects;
CREATE POLICY shared_product_images_workspace_update
  ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (
    bucket_id = 'shared-product-images'
    AND (storage.foldername(name))[1] = 'a1000000-0000-0000-0000-000000000001'
  )
  WITH CHECK (
    bucket_id = 'shared-product-images'
    AND (storage.foldername(name))[1] = 'a1000000-0000-0000-0000-000000000001'
  );
DROP POLICY IF EXISTS shared_product_images_workspace_delete ON storage.objects;
CREATE POLICY shared_product_images_workspace_delete
  ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'shared-product-images'
    AND (storage.foldername(name))[1] = 'a1000000-0000-0000-0000-000000000001'
  );

-- Upsert products into the shared workspace. No login required.
-- Returns { "processed": <int>, "skipped": [<source_product_id>, ...] }.
DROP FUNCTION IF EXISTS public.publish_shared_product_catalog(JSONB);
CREATE FUNCTION public.publish_shared_product_catalog(p_products JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_workspace_id UUID := 'a1000000-0000-0000-0000-000000000001';
  v_product RECORD;
  v_processed INTEGER := 0;
  v_skipped JSONB := '[]'::jsonb;
BEGIN
  IF p_products IS NULL OR jsonb_typeof(p_products) <> 'array'
     OR jsonb_array_length(p_products) > 10000 THEN
    RAISE EXCEPTION 'Product catalog must be an array containing at most 10000 products'
      USING ERRCODE = '22023';
  END IF;

  FOR v_product IN
    SELECT *
    FROM jsonb_to_recordset(p_products) AS p(
      source_product_id TEXT,
      name_ar TEXT,
      name_en TEXT,
      sku TEXT,
      barcode TEXT,
      category_name TEXT,
      unit_name TEXT,
      unit_symbol TEXT,
      cost_price NUMERIC,
      selling_price NUMERIC,
      wholesale_price NUMERIC,
      tax_rate NUMERIC,
      min_stock NUMERIC,
      image_url TEXT
    )
  LOOP
    -- Invalid rows are skipped (reported) instead of aborting the batch.
    IF v_product.source_product_id IS NULL OR length(v_product.source_product_id) > 120
       OR v_product.name_ar IS NULL OR length(btrim(v_product.name_ar)) NOT BETWEEN 1 AND 200
       OR v_product.sku IS NULL OR length(btrim(v_product.sku)) NOT BETWEEN 1 AND 120
       OR length(COALESCE(v_product.name_en, '')) > 200
       OR length(COALESCE(v_product.barcode, '')) > 120
       OR length(COALESCE(v_product.category_name, '')) > 120
       OR v_product.unit_name IS NULL OR length(btrim(v_product.unit_name)) NOT BETWEEN 1 AND 80
       OR v_product.unit_symbol IS NULL OR length(btrim(v_product.unit_symbol)) NOT BETWEEN 1 AND 24
       OR COALESCE(v_product.cost_price, 0) < 0 OR COALESCE(v_product.cost_price, 0) > 1000000000000
       OR v_product.selling_price IS NULL OR v_product.selling_price < 0 OR v_product.selling_price > 1000000000000
       OR COALESCE(v_product.wholesale_price, 0) < 0 OR COALESCE(v_product.wholesale_price, 0) > 1000000000000
       OR COALESCE(v_product.wholesale_price, 0) > COALESCE(v_product.selling_price, 0)
       OR COALESCE(v_product.tax_rate, 0) < 0 OR COALESCE(v_product.tax_rate, 0) > 100
       OR COALESCE(v_product.min_stock, 0) < 0 OR COALESCE(v_product.min_stock, 0) > 1000000000000
       OR (
         v_product.image_url IS NOT NULL
         AND v_product.image_url !~ (
           '^https://[^/]+/storage/v1/object/public/shared-product-images/'
           || v_workspace_id::text || '/[A-Za-z0-9._%-]+$'
         )
       ) THEN
      v_skipped := v_skipped || to_jsonb(COALESCE(v_product.source_product_id, 'unknown'));
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.shared_product_catalog (
        tenant_id, source_product_id, name_ar, name_en, sku, barcode,
        category_name, unit_name, unit_symbol, cost_price, selling_price, wholesale_price,
        tax_rate, min_stock, image_url, updated_at
      )
      VALUES (
        v_workspace_id, v_product.source_product_id, btrim(v_product.name_ar),
        NULLIF(btrim(v_product.name_en), ''), btrim(v_product.sku),
        NULLIF(btrim(v_product.barcode), ''), NULLIF(btrim(v_product.category_name), ''),
        btrim(v_product.unit_name), btrim(v_product.unit_symbol),
        COALESCE(v_product.cost_price, 0), v_product.selling_price,
        COALESCE(v_product.wholesale_price, 0), COALESCE(v_product.tax_rate, 0.17),
        COALESCE(v_product.min_stock, 0), v_product.image_url, now()
      )
      ON CONFLICT (tenant_id, sku) DO UPDATE SET
        source_product_id = EXCLUDED.source_product_id,
        name_ar = EXCLUDED.name_ar,
        name_en = EXCLUDED.name_en,
        barcode = EXCLUDED.barcode,
        category_name = EXCLUDED.category_name,
        unit_name = EXCLUDED.unit_name,
        unit_symbol = EXCLUDED.unit_symbol,
        cost_price = EXCLUDED.cost_price,
        selling_price = EXCLUDED.selling_price,
        wholesale_price = EXCLUDED.wholesale_price,
        tax_rate = EXCLUDED.tax_rate,
        min_stock = EXCLUDED.min_stock,
        image_url = EXCLUDED.image_url,
        updated_at = now();
      v_processed := v_processed + 1;
    EXCEPTION WHEN unique_violation THEN
      -- SKU/barcode already belongs to a different row: skip and report.
      v_skipped := v_skipped || to_jsonb(v_product.source_product_id);
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_shared_product_catalog(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_shared_product_catalog(JSONB) TO anon, authenticated;

-- Read the whole shared workspace catalog. No login required.
DROP FUNCTION IF EXISTS public.get_shared_product_catalog();
CREATE FUNCTION public.get_shared_product_catalog()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      jsonb_agg(to_jsonb(c) ORDER BY c.name_ar, c.source_product_id),
      '[]'::jsonb
    )
    FROM public.shared_product_catalog c
    WHERE c.tenant_id = 'a1000000-0000-0000-0000-000000000001'::uuid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_product_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_product_catalog() TO anon, authenticated;
