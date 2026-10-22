BEGIN;

-- Evita crear las tablas accidentalmente en otra base de datos.
DO $$
BEGIN
    IF current_database() <> 'control_medico' THEN
        RAISE EXCEPTION
            'Selecciona la base de datos control_medico antes de ejecutar este archivo.';
    END IF;
END;
$$;

-- Permite combinar identificadores e intervalos para evitar cruces de citas.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Cuentas de acceso.
CREATE TABLE public.usuarios (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    rol VARCHAR(20) NOT NULL,
    telefono VARCHAR(25),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT usuarios_nombre_valido
        CHECK (length(trim(nombre)) > 0),

    CONSTRAINT usuarios_email_valido
        CHECK (
            length(trim(email)) > 0
            AND email = trim(email)
        ),

    CONSTRAINT usuarios_rol_valido
        CHECK (
            rol IN ('admin', 'doctor', 'recepcionista', 'paciente')
        )
);

-- Impide registrar el mismo correo cambiando solo mayúsculas.
CREATE UNIQUE INDEX usuarios_email_unico
    ON public.usuarios (lower(email));

-- 2. Pacientes.
CREATE TABLE public.pacientes (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id INTEGER UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    telefono VARCHAR(25),
    email VARCHAR(254),
    direccion TEXT,
    alergias TEXT,
    antecedentes TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pacientes_usuario_fk
        FOREIGN KEY (usuario_id)
        REFERENCES public.usuarios (id)
        ON DELETE RESTRICT,

    CONSTRAINT pacientes_nombre_valido
        CHECK (length(trim(nombre)) > 0),

    CONSTRAINT pacientes_estado_valido
        CHECK (estado IN ('activo', 'tratamiento', 'inactivo'))
);

-- 3. Doctores.
CREATE TABLE public.doctores (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id INTEGER NOT NULL UNIQUE,
    especialidad VARCHAR(120) NOT NULL,
    licencia VARCHAR(60) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT doctores_usuario_fk
        FOREIGN KEY (usuario_id)
        REFERENCES public.usuarios (id)
        ON DELETE RESTRICT,

    CONSTRAINT doctores_especialidad_valida
        CHECK (length(trim(especialidad)) > 0),

    CONSTRAINT doctores_licencia_valida
        CHECK (length(trim(licencia)) > 0)
);

-- 4. Horarios habituales.
-- Días: 1 lunes, 2 martes, 3 miércoles, 4 jueves,
-- 5 viernes, 6 sábado y 7 domingo.
-- Las horas representan la hora local de la clínica.
CREATE TABLE public.horarios_doctores (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id INTEGER NOT NULL,
    dia_semana SMALLINT NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,

    CONSTRAINT horarios_doctor_fk
        FOREIGN KEY (doctor_id)
        REFERENCES public.doctores (id)
        ON DELETE RESTRICT,

    CONSTRAINT horarios_dia_valido
        CHECK (dia_semana BETWEEN 1 AND 7),

    CONSTRAINT horarios_orden_valido
        CHECK (hora_fin > hora_inicio),

    CONSTRAINT horarios_bloque_unico
        UNIQUE (doctor_id, dia_semana, hora_inicio, hora_fin)
);

-- 5. Citas.
CREATE TABLE public.citas (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paciente_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    fecha_hora TIMESTAMPTZ NOT NULL,
    fecha_hora_fin TIMESTAMPTZ NOT NULL,
    motivo TEXT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    motivo_cancelacion TEXT,
    importe_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT citas_paciente_fk
        FOREIGN KEY (paciente_id)
        REFERENCES public.pacientes (id)
        ON DELETE RESTRICT,

    CONSTRAINT citas_doctor_fk
        FOREIGN KEY (doctor_id)
        REFERENCES public.doctores (id)
        ON DELETE RESTRICT,

    CONSTRAINT citas_intervalo_valido
        CHECK (fecha_hora_fin > fecha_hora),

    CONSTRAINT citas_motivo_valido
        CHECK (length(trim(motivo)) > 0),

    CONSTRAINT citas_estado_valido
        CHECK (
            estado IN (
                'pendiente',
                'confirmada',
                'completada',
                'cancelada'
            )
        ),

    CONSTRAINT citas_importe_valido
        CHECK (
            importe_total >= 0
            AND importe_total < 10000000000
        ),

    CONSTRAINT citas_doctor_sin_cruces
        EXCLUDE USING gist (
            doctor_id WITH =,
            tstzrange(fecha_hora, fecha_hora_fin, '[)') WITH &&
        )
        WHERE (estado <> 'cancelada'),

    CONSTRAINT citas_paciente_sin_cruces
        EXCLUDE USING gist (
            paciente_id WITH =,
            tstzrange(fecha_hora, fecha_hora_fin, '[)') WITH &&
        )
        WHERE (estado <> 'cancelada')
);

-- 6. Catálogo de tratamientos.
CREATE TABLE public.tratamientos (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    costo NUMERIC(12, 2) NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT tratamientos_nombre_valido
        CHECK (length(trim(nombre)) > 0),

    CONSTRAINT tratamientos_costo_valido
        CHECK (costo >= 0 AND costo < 10000000000)
);

-- 7. Registro clínico de cada consulta.
CREATE TABLE public.historial_clinico (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cita_id INTEGER NOT NULL UNIQUE,
    tratamiento_id INTEGER,
    diagnostico TEXT NOT NULL,
    indicaciones TEXT,
    notas TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT historial_cita_fk
        FOREIGN KEY (cita_id)
        REFERENCES public.citas (id)
        ON DELETE RESTRICT,

    CONSTRAINT historial_tratamiento_fk
        FOREIGN KEY (tratamiento_id)
        REFERENCES public.tratamientos (id)
        ON DELETE RESTRICT,

    CONSTRAINT historial_diagnostico_valido
        CHECK (length(trim(diagnostico)) > 0)
);

-- 8. Pagos y abonos asociados a una cita.
CREATE TABLE public.pagos (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cita_id INTEGER NOT NULL,
    monto NUMERIC(12, 2) NOT NULL,
    metodo_pago VARCHAR(20) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pagado',
    fecha_pago TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    referencia VARCHAR(150),
    notas TEXT,

    CONSTRAINT pagos_cita_fk
        FOREIGN KEY (cita_id)
        REFERENCES public.citas (id)
        ON DELETE RESTRICT,

    CONSTRAINT pagos_monto_valido
        CHECK (monto > 0 AND monto < 10000000000),

    CONSTRAINT pagos_metodo_valido
        CHECK (
            metodo_pago IN ('efectivo', 'tarjeta', 'transferencia')
        ),

    CONSTRAINT pagos_estado_valido
        CHECK (estado IN ('pendiente', 'pagado', 'rechazado'))
);

-- Índices para consultas frecuentes.
CREATE INDEX pacientes_nombre_idx
    ON public.pacientes (nombre);

CREATE INDEX citas_doctor_fecha_idx
    ON public.citas (doctor_id, fecha_hora);

CREATE INDEX citas_paciente_fecha_idx
    ON public.citas (paciente_id, fecha_hora);

CREATE INDEX historial_tratamiento_idx
    ON public.historial_clinico (tratamiento_id);

CREATE INDEX pagos_cita_idx
    ON public.pagos (cita_id);

COMMIT;