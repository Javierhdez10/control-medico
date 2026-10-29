BEGIN;
DO $$ BEGIN
  IF current_database() <> 'control_medico' THEN RAISE EXCEPTION 'Selecciona control_medico'; END IF;
END $$;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS version_sesion INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.recuperaciones (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id),
  codigo_hash TEXT NOT NULL UNIQUE,
  vence_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_por INTEGER NOT NULL REFERENCES public.usuarios(id)
);
CREATE TABLE IF NOT EXISTS public.auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER REFERENCES public.usuarios(id),
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INTEGER,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  fecha TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON public.auditoria(fecha DESC);
CREATE TABLE IF NOT EXISTS public.recordatorios (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cita_id INTEGER NOT NULL REFERENCES public.citas(id),
  inicio_cita TIMESTAMPTZ NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('enviando','enviado','fallido','incierto','omitido')),
  intentos INTEGER NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  error_codigo TEXT,
  UNIQUE(cita_id, inicio_cita)
);
COMMIT;
