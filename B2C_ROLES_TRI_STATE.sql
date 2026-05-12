-- Convert existing role permissions from boolean to tri-state
-- ('allow' | 'deny' | 'prompt')
--
-- Run this AFTER B2C_ROLES_PERMISSIONS.sql. Safe to run multiple times.

DO $$
DECLARE r RECORD;
DECLARE new_perms JSONB;
DECLARE k TEXT;
DECLARE v JSONB;
BEGIN
  FOR r IN SELECT id, permissions, name FROM roles LOOP
    new_perms := '{}'::JSONB;
    FOR k, v IN SELECT * FROM jsonb_each(r.permissions) LOOP
      -- Convert: true → allow, false → deny, leave strings as-is
      IF jsonb_typeof(v) = 'boolean' THEN
        IF v::TEXT = 'true' THEN
          new_perms := new_perms || jsonb_build_object(k, 'allow');
        ELSE
          new_perms := new_perms || jsonb_build_object(k, 'deny');
        END IF;
      ELSE
        new_perms := new_perms || jsonb_build_object(k, v);
      END IF;
    END LOOP;
    UPDATE roles SET permissions = new_perms WHERE id = r.id;
  END LOOP;
END $$;


-- Now set sensitive items to 'prompt' for Cashier role (default behavior)
-- These are the things a cashier should be ABLE to do with manager approval:
UPDATE roles
   SET permissions = permissions
       || '{"pos.refund":"prompt","pos.void":"prompt","pos.price_override":"prompt","pos.close_shift":"prompt","pos.surcharge":"prompt","pos.tax_exempt":"prompt"}'::JSONB
 WHERE LOWER(name) = 'cashier' AND is_system = TRUE;

-- For Manager, prompt the most sensitive items only
UPDATE roles
   SET permissions = permissions
       || '{"settings.payment":"prompt","settings.roles":"prompt","settings.terminals":"prompt"}'::JSONB
 WHERE LOWER(name) = 'manager' AND is_system = TRUE;


-- Patch fn_user_permissions and fn_pin_login: they already pass the JSONB
-- through unchanged. The string values will arrive at the client; checking
-- truthiness will now correctly treat 'allow' and 'prompt' as truthy and
-- 'deny' as well, so we need string-aware checks on the client.
-- (Schema reload to bust PostgREST cache)
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT name,
       permissions->>'pos.refund' AS refund,
       permissions->>'pos.void'   AS void,
       permissions->>'pos.close_shift' AS close_shift
  FROM roles
 WHERE is_system = TRUE
 ORDER BY name;
