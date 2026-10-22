import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./agenda.css";

const nombresEstados = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada"
};

function hoyElSalvador() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/El_Salvador",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const valor = (tipo) =>
    partes.find((parte) => parte.type === tipo).value;

  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function moverFecha(fecha, dias) {
  const valor = new Date(`${fecha}T12:00:00.000Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function describirFecha(fecha) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(`${fecha}T12:00:00.000Z`));
}

function dinero(valor) {
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD"
  }).format(Number(valor));
}

export default function Agenda({
  token,
  onSesionExpirada
}) {
  const [doctores, setDoctores] = useState([]);
  const [doctorId, setDoctorId] = useState("");
  const [fecha, setFecha] = useState(hoyElSalvador);
  const [vista, setVista] = useState("lista");
  const [revision, setRevision] = useState(0);

  const [citas, setCitas] = useState([]);
  const [cargandoDoctores, setCargandoDoctores] = useState(true);
  const [cargandoCitas, setCargandoCitas] = useState(false);
  const [errorDoctores, setErrorDoctores] = useState("");
  const [errorCitas, setErrorCitas] = useState("");

  const [busqueda, setBusqueda] = useState("");
  const [filtroPaciente, setFiltroPaciente] = useState("");
  const [paginaPaciente, setPaginaPaciente] = useState(1);
  const [resultadoPacientes, setResultadoPacientes] = useState({
    pacientes: [],
    total_paginas: 1
  });
  const [paciente, setPaciente] = useState(null);
  const [cargandoPacientes, setCargandoPacientes] = useState(false);
  const [errorPacientes, setErrorPacientes] = useState("");

  const [duracion, setDuracion] = useState("30");
  const [horarios, setHorarios] = useState([]);
  const [seleccionHorario, setSeleccionHorario] = useState(null);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [errorHorarios, setErrorHorarios] = useState("");

  const [motivo, setMotivo] = useState("");
  const [importe, setImporte] = useState("0.00");
  const [procesando, setProcesando] = useState(false);
  const [errorAccion, setErrorAccion] = useState("");
  const [aviso, setAviso] = useState("");

  const claveHorario =
    `${doctorId}|${fecha}|${duracion}|${paciente?.id || ""}`;

  const horaElegida =
    seleccionHorario?.clave === claveHorario
      ? seleccionHorario.hora
      : "";

  useEffect(() => {
    let vigente = true;

    async function cargarDoctores() {
      setCargandoDoctores(true);
      setErrorDoctores("");

      try {
        const datos = await consultarApi("/api/agenda/doctores", {
          token
        });

        if (!vigente) {
          return;
        }

        setDoctores(datos.doctores);

        setDoctorId((actual) => {
          const existe = datos.doctores.some(
            (doctor) => String(doctor.id) === actual
          );

          return existe
            ? actual
            : String(datos.doctores[0]?.id || "");
        });
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorDoctores(error.message);
          }
        }
      } finally {
        if (vigente) {
          setCargandoDoctores(false);
        }
      }
    }

    cargarDoctores();

    return () => {
      vigente = false;
    };
  }, [token, onSesionExpirada, revision]);

  useEffect(() => {
    if (!doctorId || !fecha || vista !== "lista") {
      return undefined;
    }

    let vigente = true;
    let temporizador;

    setCargandoCitas(true);
    setErrorCitas("");

    async function cargarCitas() {
      try {
        const parametros = new URLSearchParams({
          doctor_id: doctorId,
          fecha
        });

        const datos = await consultarApi(
          `/api/agenda/citas?${parametros}`,
          { token }
        );

        if (vigente) {
          setCitas(datos.citas);
          setErrorCitas("");
        }
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorCitas(error.message);
          }
        }
      } finally {
        if (vigente) {
          setCargandoCitas(false);
          temporizador = setTimeout(cargarCitas, 30000);
        }
      }
    }

    cargarCitas();

    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [
    doctorId,
    fecha,
    vista,
    revision,
    token,
    onSesionExpirada
  ]);

  useEffect(() => {
    if (vista !== "nueva") {
      return undefined;
    }

    let vigente = true;

    async function cargarPacientes() {
      setCargandoPacientes(true);
      setErrorPacientes("");

      try {
        const parametros = new URLSearchParams({
          buscar: filtroPaciente,
          pagina: String(paginaPaciente)
        });

        const datos = await consultarApi(
          `/api/pacientes?${parametros}`,
          { token }
        );

        if (vigente) {
          setResultadoPacientes(datos);
        }
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorPacientes(error.message);
          }
        }
      } finally {
        if (vigente) {
          setCargandoPacientes(false);
        }
      }
    }

    cargarPacientes();

    return () => {
      vigente = false;
    };
  }, [
    vista,
    filtroPaciente,
    paginaPaciente,
    revision,
    token,
    onSesionExpirada
  ]);

  useEffect(() => {
    if (vista !== "nueva" || !doctorId || !fecha || !paciente) {
      return undefined;
    }

    let vigente = true;
    let temporizador;

    setCargandoHorarios(true);
    setErrorHorarios("");
    setHorarios([]);

    async function cargarHorarios() {
      try {
        const parametros = new URLSearchParams({
          doctor_id: doctorId,
          paciente_id: String(paciente.id),
          fecha,
          duracion
        });

        const datos = await consultarApi(
          `/api/agenda/disponibilidad?${parametros}`,
          { token }
        );

        if (vigente) {
          setHorarios(datos.horarios);
          setErrorHorarios("");

          setSeleccionHorario((actual) => {
            if (
              actual?.clave === claveHorario &&
              !datos.horarios.some(
                (horario) => horario.hora === actual.hora
              )
            ) {
              return null;
            }

            return actual;
          });
        }
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorHorarios(error.message);
          }
        }
      } finally {
        if (vigente) {
          setCargandoHorarios(false);
          temporizador = setTimeout(cargarHorarios, 30000);
        }
      }
    }

    cargarHorarios();

    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [
    vista,
    doctorId,
    fecha,
    duracion,
    paciente,
    claveHorario,
    revision,
    token,
    onSesionExpirada
  ]);

  function abrirNuevaCita() {
    setPaciente(null);
    setBusqueda("");
    setFiltroPaciente("");
    setPaginaPaciente(1);
    setDuracion("30");
    setSeleccionHorario(null);
    setMotivo("");
    setImporte("0.00");
    setErrorAccion("");
    setAviso("");

    if (fecha < hoyElSalvador()) {
      setFecha(hoyElSalvador());
    }

    setVista("nueva");
  }

  function buscarPaciente() {
    setFiltroPaciente(busqueda.trim());
    setPaginaPaciente(1);
    setRevision((actual) => actual + 1);
  }

  async function guardarCita(evento) {
    evento.preventDefault();

    if (procesando) {
      return;
    }

    if (!paciente || !horaElegida) {
      setErrorAccion("Selecciona un paciente y un horario disponible.");
      return;
    }

    setProcesando(true);
    setErrorAccion("");

    try {
      const datos = await consultarApi("/api/agenda/citas", {
        method: "POST",
        token,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          doctor_id: Number(doctorId),
          paciente_id: paciente.id,
          fecha,
          hora: horaElegida,
          duracion: Number(duracion),
          motivo,
          importe_total: importe
        })
      });

      setAviso(datos.mensaje);
      setVista("lista");
      setRevision((actual) => actual + 1);
    } catch (error) {
      if (error.status === 401) {
        onSesionExpirada();
      } else {
        setErrorAccion(error.message);

        if (error.status === 409) {
          setSeleccionHorario(null);
          setRevision((actual) => actual + 1);
        }
      }
    } finally {
      setProcesando(false);
    }
  }

  async function cambiarEstado(cita, estado) {
    if (procesando) {
      return;
    }

    const cuerpo = { estado };

    if (estado === "cancelada") {
      const motivoCancelacion = window.prompt(
        `Motivo de cancelación de la cita de ${cita.paciente}:`
      );

      if (motivoCancelacion === null) {
        return;
      }

      if (
        !motivoCancelacion.trim() ||
        motivoCancelacion.trim().length > 1000
      ) {
        setErrorAccion(
          "Escribe un motivo de cancelación de entre 1 y 1000 caracteres."
        );
        return;
      }

      cuerpo.motivo_cancelacion = motivoCancelacion.trim();
    }

    if (
      estado === "confirmada" &&
      !window.confirm(`¿Confirmar la cita de ${cita.paciente}?`)
    ) {
      return;
    }

    setProcesando(true);
    setErrorAccion("");
    setAviso("");

    try {
      const datos = await consultarApi(
        `/api/agenda/citas/${cita.id}/estado`,
        {
          method: "PATCH",
          token,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(cuerpo)
        }
      );

      setAviso(datos.mensaje);
      setRevision((actual) => actual + 1);
    } catch (error) {
      if (error.status === 401) {
        onSesionExpirada();
      } else {
        setErrorAccion(error.message);
        setRevision((actual) => actual + 1);
      }
    } finally {
      setProcesando(false);
    }
  }

  const doctorActual = doctores.find(
    (doctor) => String(doctor.id) === doctorId
  );

  return (
    <section className="modulo-agenda">
      <header className="cabecera-modulo">
        <div>
          <h1>
            {vista === "nueva" ? "Agendar nueva cita" : "Agenda de citas"}
          </h1>
          <p className="descripcion">
            {vista === "nueva"
              ? "Selecciona un paciente y un horario disponible"
              : "Gestión de citas y horarios clínicos"}
          </p>
        </div>

        {vista === "lista" && (
          <button
            type="button"
            className="boton-principal boton-ajustado"
            onClick={abrirNuevaCita}
            disabled={
              !doctorId || cargandoDoctores || procesando
            }
          >
            + Nueva cita
          </button>
        )}
      </header>

      {errorDoctores && (
        <p className="mensaje mensaje-error" role="alert">
          {errorDoctores}
        </p>
      )}

      {!cargandoDoctores &&
        !errorDoctores &&
        doctores.length === 0 && (
          <p className="mensaje mensaje-aviso" role="status">
            No hay doctores activos disponibles.
          </p>
        )}

      <div className="tarjeta filtros-agenda">
        <div className="campo">
          <label htmlFor="doctor-agenda">Doctor</label>
          <select
            id="doctor-agenda"
            value={doctorId}
            onChange={(evento) => {
              setDoctorId(evento.target.value);
              setSeleccionHorario(null);
              setErrorAccion("");
            }}
            disabled={cargandoDoctores || procesando}
          >
            <option value="">
              {cargandoDoctores ? "Cargando doctores..." : "Selecciona un doctor"}
            </option>
            {doctores.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.nombre} — {doctor.especialidad}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="fecha-agenda">Fecha</label>
          <input
            id="fecha-agenda"
            type="date"
            min={vista === "nueva" ? hoyElSalvador() : "1900-01-01"}
            max="2100-12-31"
            value={fecha}
            onChange={(evento) => {
              if (evento.target.value) {
                setFecha(evento.target.value);
                setSeleccionHorario(null);
                setErrorAccion("");
              }
            }}
            disabled={procesando}
          />
        </div>

        <button
          type="button"
          className="boton-secundario"
          onClick={() => setRevision((actual) => actual + 1)}
          disabled={procesando}
        >
          Actualizar
        </button>
      </div>

      {aviso && (
        <p className="mensaje mensaje-aviso" role="status">
          {aviso}
        </p>
      )}

      {vista === "lista" && (
        <div className="tarjeta tarjeta-agenda">
          <header className="fecha-agenda">
            <div>
              <h2>{describirFecha(fecha)}</h2>
              <p className="descripcion">
                {doctorActual?.nombre || "Selecciona un doctor"}
              </p>
            </div>

            <div className="navegacion-fecha">
              <button
                type="button"
                className="boton-secundario"
                onClick={() => setFecha(moverFecha(fecha, -1))}
                disabled={procesando || fecha <= "1900-01-01"}
                aria-label="Día anterior"
              >
                Anterior
              </button>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => setFecha(hoyElSalvador())}
                disabled={procesando}
              >
                Hoy
              </button>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => setFecha(moverFecha(fecha, 1))}
                disabled={procesando || fecha >= "2100-12-31"}
                aria-label="Día siguiente"
              >
                Siguiente
              </button>
            </div>
          </header>

          {errorAccion && (
            <p className="mensaje mensaje-error" role="alert">
              {errorAccion}
            </p>
          )}

          {errorCitas ? (
            <p className="mensaje mensaje-error" role="alert">
              {errorCitas}
            </p>
          ) : cargandoCitas ? (
            <p className="vacio-agenda" role="status">
              Cargando citas...
            </p>
          ) : !doctorId ? (
            <p className="vacio-agenda">
              Selecciona un doctor para consultar su agenda.
            </p>
          ) : citas.length === 0 ? (
            <p className="vacio-agenda">
              No hay citas registradas para esta fecha.
            </p>
          ) : (
            <div className="lista-citas">
              {citas.map((cita) => (
                <article className="fila-cita" key={cita.id}>
                  <time
                    className="hora-cita"
                    dateTime={cita.fecha_hora}
                  >
                    {cita.hora}
                  </time>

                  <div className={`bloque-cita cita-${cita.estado}`}>
                    <div className="detalle-cita">
                      <h3>{cita.paciente}</h3>
                      <p>{cita.motivo}</p>
                      <span>
                        {cita.duracion} min · {dinero(cita.importe_total)}
                      </span>

                      {cita.motivo_cancelacion && (
                        <p className="motivo-cancelacion">
                          Cancelación: {cita.motivo_cancelacion}
                        </p>
                      )}
                    </div>

                    <div className="acciones-cita">
                      <strong className="texto-estado-cita">
                        {nombresEstados[cita.estado]}
                      </strong>

                      {cita.estado === "pendiente" && (
                        <button
                          type="button"
                          className="boton-secundario"
                          onClick={() =>
                            cambiarEstado(cita, "confirmada")
                          }
                          disabled={procesando}
                        >
                          Confirmar
                        </button>
                      )}

                      {["pendiente", "confirmada"].includes(cita.estado) && (
                        <button
                          type="button"
                          className="boton-secundario boton-cancelar-cita"
                          onClick={() =>
                            cambiarEstado(cita, "cancelada")
                          }
                          disabled={procesando}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {vista === "nueva" && (
        <form
          className="tarjeta formulario-paciente formulario-cita"
          onSubmit={guardarCita}
          aria-busy={procesando}
        >
          <fieldset disabled={procesando}>
            <legend className="solo-lectores">
              Datos de la nueva cita
            </legend>

            <div className="campo">
              <label htmlFor="buscar-paciente-cita">
                Buscar paciente por nombre
              </label>
              <div className="buscar-paciente-cita">
                <input
                  id="buscar-paciente-cita"
                  value={busqueda}
                  onChange={(evento) =>
                    setBusqueda(evento.target.value)
                  }
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter") {
                      evento.preventDefault();
                      buscarPaciente();
                    }
                  }}
                  maxLength={150}
                  placeholder="Escribe un nombre..."
                />
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={buscarPaciente}
                >
                  Buscar
                </button>
              </div>
            </div>

            {errorPacientes && (
              <p className="mensaje mensaje-error" role="alert">
                {errorPacientes}
              </p>
            )}

            <div className="resultados-pacientes" aria-busy={cargandoPacientes}>
              {cargandoPacientes ? (
                <p className="descripcion">Buscando pacientes...</p>
              ) : resultadoPacientes.pacientes.length === 0 ? (
                <p className="descripcion">
                  No se encontraron pacientes.
                </p>
              ) : (
                resultadoPacientes.pacientes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`resultado-paciente ${
                      paciente?.id === item.id ? "seleccionado" : ""
                    }`}
                    onClick={() => {
                      setPaciente(item);
                      setSeleccionHorario(null);
                      setErrorAccion("");
                    }}
                    disabled={item.estado === "inactivo"}
                    aria-pressed={paciente?.id === item.id}
                  >
                    <strong>{item.nombre}</strong>
                    <span>
                      ID {item.id} · {item.telefono || "Sin teléfono"}
                      {item.estado === "inactivo" ? " · Inactivo" : ""}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="paginacion-selector">
              <button
                type="button"
                className="boton-secundario"
                disabled={cargandoPacientes || paginaPaciente === 1}
                onClick={() =>
                  setPaginaPaciente((actual) => actual - 1)
                }
              >
                Anterior
              </button>
              <span>
                Página {paginaPaciente} de {resultadoPacientes.total_paginas}
              </span>
              <button
                type="button"
                className="boton-secundario"
                disabled={
                  cargandoPacientes ||
                  paginaPaciente >= resultadoPacientes.total_paginas
                }
                onClick={() =>
                  setPaginaPaciente((actual) => actual + 1)
                }
              >
                Siguiente
              </button>
            </div>

            {paciente && (
              <p className="mensaje mensaje-aviso">
                Paciente seleccionado: <strong>{paciente.nombre}</strong>
              </p>
            )}

            <div className="rejilla-formulario">
              <div className="campo">
                <label htmlFor="duracion-cita">Duración</label>
                <select
                  id="duracion-cita"
                  value={duracion}
                  onChange={(evento) => {
                    setDuracion(evento.target.value);
                    setSeleccionHorario(null);
                  }}
                >
                  <option value="15">15 minutos</option>
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">60 minutos</option>
                </select>
              </div>

              <div className="campo">
                <label htmlFor="importe-cita">Importe de la cita ($)</label>
                <input
                  id="importe-cita"
                  type="number"
                  min="0"
                  max="99999999.99"
                  step="0.01"
                  value={importe}
                  onChange={(evento) => setImporte(evento.target.value)}
                  required
                />
              </div>
            </div>

            <div className="campo">
              <p className="titulo-horarios">Horarios disponibles</p>

              {!paciente || !doctorId ? (
                <p className="descripcion">
                  Selecciona el doctor y el paciente para consultar horarios.
                </p>
              ) : errorHorarios ? (
                <p className="mensaje mensaje-error" role="alert">
                  {errorHorarios}
                </p>
              ) : cargandoHorarios ? (
                <p className="descripcion" role="status">
                  Consultando disponibilidad...
                </p>
              ) : horarios.length === 0 ? (
                <p className="mensaje mensaje-aviso">
                  No hay horarios disponibles para esta fecha y duración.
                </p>
              ) : (
                <div className="rejilla-horarios">
                  {horarios.map((horario) => (
                    <button
                      key={horario.inicio}
                      type="button"
                      className={`boton-horario ${
                        horaElegida === horario.hora ? "seleccionado" : ""
                      }`}
                      aria-pressed={horaElegida === horario.hora}
                      onClick={() =>
                        setSeleccionHorario({
                          clave: claveHorario,
                          hora: horario.hora
                        })
                      }
                    >
                      {horario.hora}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="campo">
              <label htmlFor="motivo-cita">Motivo de consulta *</label>
              <textarea
                id="motivo-cita"
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Describe el motivo de la cita..."
                required
              />
            </div>

            {errorAccion && (
              <p className="mensaje mensaje-error" role="alert">
                {errorAccion}
              </p>
            )}

            <div className="acciones-formulario">
              <button
                type="button"
                className="boton-secundario"
                onClick={() => {
                  setVista("lista");
                  setErrorAccion("");
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="boton-principal boton-ajustado"
                disabled={
                  !paciente ||
                  !horaElegida ||
                  cargandoHorarios ||
                  Boolean(errorHorarios) ||
                  !doctorId
                }
              >
                {procesando ? "Guardando..." : "Agendar cita"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}