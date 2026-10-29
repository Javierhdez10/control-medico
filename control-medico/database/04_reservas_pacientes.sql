BEGIN;
DO $$
BEGIN
  IF current_database() <> 'control_medico' THEN
    RAISE EXCEPTION 'Selecciona la base de datos control_medico.';
  END IF;
END;
$$;
ALTER TABLE public.citas ADD COLUMN IF NOT EXISTS importe_pendiente BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
