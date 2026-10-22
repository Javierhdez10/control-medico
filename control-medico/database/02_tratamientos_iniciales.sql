BEGIN;

DO $$
BEGIN
    IF current_database() <> 'control_medico' THEN
        RAISE EXCEPTION
            'Debes ejecutar este archivo en control_medico.';
    END IF;
END;
$$;

INSERT INTO public.tratamientos (
    nombre,
    descripcion,
    costo,
    activo
)
SELECT
    'Consulta general',
    'Evaluación y atención médica general.',
    0.00,
    TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tratamientos
    WHERE lower(nombre) = lower('Consulta general')
);

INSERT INTO public.tratamientos (
    nombre,
    descripcion,
    costo,
    activo
)
SELECT
    'Consulta de seguimiento',
    'Revisión de la evolución de una atención previa.',
    0.00,
    TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tratamientos
    WHERE lower(nombre) = lower('Consulta de seguimiento')
);

INSERT INTO public.tratamientos (
    nombre,
    descripcion,
    costo,
    activo
)
SELECT
    'Evaluación preventiva',
    'Evaluación orientada al control preventivo.',
    0.00,
    TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM public.tratamientos
    WHERE lower(nombre) = lower('Evaluación preventiva')
);

COMMIT;