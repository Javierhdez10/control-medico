BEGIN;

DO $$
BEGIN
    IF current_database() <> 'control_medico' THEN
        RAISE EXCEPTION
            'Debes ejecutar este archivo en control_medico.';
    END IF;
END;
$$;

ALTER TABLE public.pagos
    ADD COLUMN IF NOT EXISTS clave_operacion UUID;

ALTER TABLE public.pagos
    ADD COLUMN IF NOT EXISTS recibido_por INTEGER
    REFERENCES public.usuarios(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS pagos_clave_operacion_unica
    ON public.pagos (clave_operacion);

COMMIT;