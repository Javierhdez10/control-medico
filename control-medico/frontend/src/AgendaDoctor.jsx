import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./agenda-doctor.css";

const zonaHoraria = "America/El_Salvador";

const nombresEstados = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada"
};

const formatoHora = new Intl.DateTimeFormat("es-SV", {
  timeZone: zonaHoraria,
  hour: "2-digit",
  minute: "2-digit"
});

const formatoFecha = new Intl.DateTimeFormat("es-SV", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});

function fechaHoy() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const valor = (tipo) =>
    partes.find((parte) => parte.type === tipo).value;

  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function esFechaValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  if (valor < "1900-01-01" || valor > "2100-12-31") {
    return false;
  }

  const fecha = new Date(`${valor}T12:00:00Z`);

  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
}

function moverFecha(fecha, cantidad) {
  const resultado = new Date(`${fecha}T12:00:00Z`);
  resultado.setUTCDate(resultado.getUTCDate() + cantidad);
  return resultado.toISOString().slice(0, 10);
}

function hora(valor) {
  return formatoHora.format(new Date(valor));
}

function textoAccion(cita) {
  if (cita.estado === "cancelada") {
    return "Cita cancelada";
  }

  if (cita.estado === "pendiente") {
    return "Pendiente de confirmación";
  }

  if (cita.estado === "confirmada" && !cita.puede_atender) {
    return "Aún no llega la hora";
  }

  return "";
}

export default function AgendaDoctor({
  sesion,
  onSesionExpirada,
  onAbrirHistorial
}) {
  const [fecha, setFecha] = useState(fechaHoy);
  const [revision, setRevision] = useState(0);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const fechaCorrecta = esFechaValida(fecha);

  useEffect(() => {
    if (!fechaCorrecta) {
      return undefined;
    }

    let vigente = true;

    async function cargarAgenda() {
      setCargando(true);
      setError("");
      setDatos(null);

      try {
        const parametros = new URLSearchParams({ fecha });

        const respuesta = await consultarApi(
          `/api/agenda-doctor?${parametros}`,
          { token: sesion.token }
        );

        if (vigente) {
          setDatos(respuesta);
        }
      } catch (fallo) {
        if (!vigente) {
          return;
        }

        if (fallo.status === 401) {
          onSesionExpirada();
          return;
        }

        setError(fallo.message);
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargarAgenda();

    return () => {
      vigente = false;
    };
  }, [
    fecha,
    fechaCorrecta,
    revision,
    sesion.token,
    onSesionExpirada
  ]);

  const datosVisibles =
    fechaCorrecta && datos?.fecha === fecha ? datos : null;

  function cambiarDia(cantidad) {
    if (!fechaCorrecta) {
      return;
    }

    const siguiente = moverFecha(fecha, cantidad);

    if (esFechaValida(siguiente)) {
      setFecha(siguiente);
    }
  }

  function abrirExpediente(cita) {
    const pacienteId = Number(cita.paciente_id);

    if (!Number.isInteger(pacienteId) || pacienteId < 1) {
      setError(
        "La cita no contiene el identificador del paciente. Actualiza el backend y vuelve a consultar la agenda."
      );
      return;
    }

    onAbrirHistorial(pacienteId);
  }

  return (
    <section
      className="agenda-doctor"
      aria-labelledby="titulo-agenda-doctor"
      aria-busy={fechaCorrecta && cargando}
    >
      <header className="ad-cabecera">
        <div>
          <h1 id="titulo-agenda-doctor">Mi agenda</h1>
          <p>
            Consulta tus citas y continúa con la atención
            de tus pacientes.
          </p>
        </div>

        <button
          type="button"
          className="ad-boton ad-boton-principal"
          disabled={cargando || !fechaCorrecta}
          onClick={() => setRevision((actual) => actual + 1)}
        >
          {cargando && fechaCorrecta
            ? "Actualizando..."
            : "Actualizar"}
        </button>
      </header>

      <div className="ad-filtros">
        <div className="ad-campo">
          <label htmlFor="fecha-agenda-doctor">
            Fecha de consulta
          </label>
          <input
            id="fecha-agenda-doctor"
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={fecha}
            onChange={(evento) => setFecha(evento.target.value)}
          />
        </div>

        <div className="ad-navegacion">
          <button
            type="button"
            className="ad-boton"
            disabled={!fechaCorrecta || fecha === "1900-01-01"}
            onClick={() => cambiarDia(-1)}
          >
            Día anterior
          </button>

          <button
            type="button"
            className="ad-boton"
            onClick={() => {
              setFecha(fechaHoy());
              setRevision((actual) => actual + 1);
            }}
          >
            Hoy
          </button>

          <button
            type="button"
            className="ad-boton"
            disabled={!fechaCorrecta || fecha === "2100-12-31"}
            onClick={() => cambiarDia(1)}
          >
            Día siguiente
          </button>
        </div>
      </div>

      {!fechaCorrecta && (
        <p className="ad-error" role="alert">
          Selecciona una fecha válida entre 1900 y 2100.
        </p>
      )}

      {fechaCorrecta && error && (
        <div className="ad-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="ad-boton"
            disabled={cargando}
            onClick={() => setRevision((actual) => actual + 1)}
          >
            Reintentar
          </button>
        </div>
      )}

      {fechaCorrecta && cargando && (
        <p role="status">Consultando tus citas...</p>
      )}

      {datosVisibles && (
        <>
          <div className="ad-identidad">
            <div>
              <strong>{datosVisibles.doctor.nombre}</strong>
              <span>{datosVisibles.doctor.especialidad}</span>
            </div>
            <p>
              {formatoFecha.format(
                new Date(`${datosVisibles.fecha}T12:00:00Z`)
              )}
            </p>
          </div>

          <div className="ad-resumen">
            {[
              ["Pendientes", datosVisibles.pendientes],
              ["Confirmadas", datosVisibles.confirmadas],
              ["Completadas", datosVisibles.completadas],
              ["Canceladas", datosVisibles.canceladas]
            ].map(([etiqueta, cantidad]) => (
              <article className="ad-tarjeta" key={etiqueta}>
                <h2>{etiqueta}</h2>
                <p>{cantidad}</p>
              </article>
            ))}
          </div>

          <div className="ad-listado">
            <div className="ad-listado-cabecera">
              <h2>Citas del día</h2>
              <p>
                Mostrando {datosVisibles.citas.length} de{" "}
                {datosVisibles.total} citas.
              </p>
            </div>

            {datosVisibles.citas.length === 0 ? (
              <p className="ad-vacio">
                No tienes citas programadas para esta fecha.
              </p>
            ) : (
              <div className="ad-tabla-contenedor">
                <table className="ad-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Horario</th>
                      <th scope="col">Paciente</th>
                      <th scope="col">Motivo</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Atención</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datosVisibles.citas.map((cita) => (
                      <tr key={cita.id}>
                        <td className="ad-horario">
                          {hora(cita.fecha_hora)}
                          <span>a {hora(cita.fecha_hora_fin)}</span>
                        </td>
                        <td>{cita.paciente}</td>
                        <td className="ad-motivo">{cita.motivo}</td>
                        <td>
                          <span
                            className={`ad-estado ad-estado-${cita.estado}`}
                          >
                            {nombresEstados[cita.estado]}
                          </span>
                        </td>
                        <td>
                          {cita.puede_atender ||
                          cita.estado === "completada" ? (
                            <button
                              type="button"
                              className="ad-boton"
                              onClick={() => abrirExpediente(cita)}
                            >
                              Ir al historial
                            </button>
                          ) : (
                            <span className="ad-ayuda">
                              {textoAccion(cita)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ad-pie">
              <p>
                “Ir al historial” abre directamente el expediente
                del paciente seleccionado.
              </p>
              <p>
                Actualizado a las{" "}
                {hora(datosVisibles.actualizado_en)}.
                Pulsa Actualizar si recepción modificó una cita
                o acaba de llegar su hora.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}