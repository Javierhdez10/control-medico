import { useEffect, useState } from "react";
import { consultarApi } from "./api";
import "./dashboard.css";

const zonaHoraria = "America/El_Salvador";

const formatoMoneda = new Intl.NumberFormat("es-SV", {
  style: "currency",
  currency: "USD"
});

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

const estados = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada"
};

function mostrarFecha(fecha) {
  return formatoFecha.format(
    new Date(`${fecha}T12:00:00Z`)
  );
}

function mostrarHora(fecha) {
  return formatoHora.format(new Date(fecha));
}

export default function Dashboard({
  sesion,
  onSesionExpirada
}) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const token = sesion.token;

  useEffect(() => {
    let vigente = true;

    async function cargarDashboard() {
      setCargando(true);
      setError("");

      try {
        const respuesta = await consultarApi(
          "/api/dashboard",
          { token }
        );

        if (!vigente) {
          return;
        }

        setDatos(respuesta.dashboard);
      } catch (errorConsulta) {
        if (!vigente) {
          return;
        }

        if (errorConsulta.status === 401) {
          onSesionExpirada();
          return;
        }

        setError(errorConsulta.message);
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargarDashboard();

    return () => {
      vigente = false;
    };
  }, [token, revision, onSesionExpirada]);

  const indicadores = datos
    ? [
        {
          titulo: "Pacientes registrados",
          valor: datos.pacientes_registrados,
          descripcion: "Total de pacientes en el sistema",
          variante: "pacientes"
        },
        {
          titulo: "Citas de hoy",
          valor: datos.citas_hoy,
          descripcion: "Sin incluir las canceladas",
          variante: "citas"
        },
        {
          titulo: "Consultas completadas hoy",
          valor: datos.consultas_completadas_hoy,
          descripcion: "Según la fecha programada de la cita",
          variante: "consultas"
        },
        {
          titulo: "Ingresos del mes",
          valor: formatoMoneda.format(
            Number(datos.ingresos_mes)
          ),
          descripcion: "Pagos registrados como recibidos",
          variante: "ingresos"
        }
      ]
    : [];

  return (
    <section
      className="dashboard"
      aria-labelledby="titulo-dashboard"
      aria-busy={cargando}
    >
      <header className="dashboard-cabecera">
        <div>
          <p className="dashboard-saludo">
            Hola, {sesion.usuario.nombre}
          </p>

          <h1 id="titulo-dashboard">Dashboard</h1>

          <p className="dashboard-descripcion">
            Resumen de la actividad de la clínica.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-boton"
          onClick={() => setRevision((valor) => valor + 1)}
          disabled={cargando}
        >
          {cargando ? "Actualizando..." : "Actualizar"}
        </button>
      </header>

      {error && (
        <div className="dashboard-error" role="alert">
          <p>{error}</p>

          {datos && (
            <p>
              Los datos visibles corresponden a la última
              consulta exitosa.
            </p>
          )}
        </div>
      )}

      {cargando && !datos && (
        <p role="status">Cargando el resumen de la clínica...</p>
      )}

      {datos && (
        <>
          <div className="dashboard-periodo">
            <p>{mostrarFecha(datos.fecha_local)}</p>

            <p>
              Última actualización:{" "}
              {mostrarHora(datos.actualizado_en)}
            </p>
          </div>

          <div className="dashboard-indicadores">
            {indicadores.map((indicador) => (
              <article
                className={
                  `dashboard-indicador ` +
                  `dashboard-indicador--${indicador.variante}`
                }
                key={indicador.variante}
              >
                <h2>{indicador.titulo}</h2>

                <p className="dashboard-valor">
                  {indicador.valor}
                </p>

                <p className="dashboard-ayuda">
                  {indicador.descripcion}
                </p>
              </article>
            ))}
          </div>

          <section
            className="dashboard-agenda"
            aria-labelledby="titulo-agenda-dashboard"
          >
            <div className="dashboard-agenda-cabecera">
              <div>
                <h2 id="titulo-agenda-dashboard">
                  Agenda de hoy
                </h2>

                <p>
                  {datos.total_agenda_hoy === 0
                    ? "No hay citas programadas para este día."
                    : `Mostrando ${datos.agenda_hoy.length} de ${datos.total_agenda_hoy} citas.`}
                </p>
              </div>
            </div>

            {datos.agenda_hoy.length > 0 ? (
              <div className="dashboard-tabla-contenedor">
                <table className="dashboard-tabla">
                  <caption className="dashboard-solo-lectores">
                    Primeras 20 citas del día, ordenadas por hora.
                  </caption>

                  <thead>
                    <tr>
                      <th scope="col">Hora</th>
                      <th scope="col">Paciente</th>
                      <th scope="col">Doctor</th>
                      <th scope="col">Especialidad</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {datos.agenda_hoy.map((cita) => (
                      <tr key={cita.id}>
                        <td>{mostrarHora(cita.fecha_hora)}</td>
                        <td>{cita.paciente}</td>
                        <td>{cita.doctor}</td>
                        <td>{cita.especialidad}</td>
                        <td>
                          <span
                            className={
                              `dashboard-estado ` +
                              `dashboard-estado--${cita.estado}`
                            }
                          >
                            {estados[cita.estado] ?? cita.estado}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="dashboard-vacio">
                Las citas que registres para hoy aparecerán aquí.
              </div>
            )}

            <p className="dashboard-nota">
              Para registrar, confirmar o cancelar citas,
              utiliza el módulo Agenda.
            </p>
          </section>
        </>
      )}
    </section>
  );
}