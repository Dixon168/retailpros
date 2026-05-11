-- ════════════════════════════════════════════════════════════════════
-- Barcode/Label Printing — templates + tenant printer setting
-- ════════════════════════════════════════════════════════════════════
-- A "template" describes a label: size (mm), barcode format, what
-- product fields appear, font sizes, alignment, store name, etc.
-- Cashiers/managers can save many templates and pick one when printing.
-- ════════════════════════════════════════════════════════════════════

-- ── Tenant setting: default label printer name (e.g. "DYMO LabelWriter") ──
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_label_printer TEXT;
COMMENT ON COLUMN tenants.default_label_printer IS
  'Default printer name for labels. Empty = browser print dialog (user picks).';


CREATE TABLE IF NOT EXISTS barcode_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- Physical size
  width_mm        NUMERIC(6,2) NOT NULL DEFAULT 50,
  height_mm       NUMERIC(6,2) NOT NULL DEFAULT 25,
  -- Barcode style
  barcode_format  TEXT NOT NULL DEFAULT 'CODE128'
                  CHECK (barcode_format IN ('CODE128','EAN13','EAN8','UPC','CODE39','ITF14','QR')),
  barcode_height_mm NUMERIC(6,2) DEFAULT 10,
  -- What to show (boolean flags + sizes in pt)
  show_store_name BOOLEAN DEFAULT FALSE,
  show_name       BOOLEAN DEFAULT TRUE,
  show_sku        BOOLEAN DEFAULT TRUE,
  show_price      BOOLEAN DEFAULT TRUE,
  show_barcode    BOOLEAN DEFAULT TRUE,
  show_barcode_text BOOLEAN DEFAULT TRUE,
  show_date       BOOLEAN DEFAULT FALSE,
  -- Font sizes (pt)
  name_size_pt    NUMERIC(4,1) DEFAULT 9,
  price_size_pt   NUMERIC(4,1) DEFAULT 12,
  sku_size_pt     NUMERIC(4,1) DEFAULT 7,
  -- Other
  printer_name    TEXT,                          -- override tenant default
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID
);
CREATE INDEX IF NOT EXISTS idx_barcode_templates_tenant ON barcode_templates(tenant_id);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION fn_touch_barcode_templates() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_barcode_templates ON barcode_templates;
CREATE TRIGGER trg_touch_barcode_templates BEFORE UPDATE ON barcode_templates
  FOR EACH ROW EXECUTE FUNCTION fn_touch_barcode_templates();


NOTIFY pgrst, 'reload schema';

SELECT 'barcode_templates' tbl, EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='barcode_templates') ok
UNION ALL SELECT 'tenants.default_label_printer',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='default_label_printer');
