import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./historial.css";
import useConfirmacion from "./useConfirmacion.jsx";

function fechaHora(valor) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: "America/El_Salvador",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(valor));
}

function fechaNacimiento(valor) {
  if (!valor) {
    return "Sin registrar";
  }

  const [anio, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${anio}`;
}

function identificadorValido(valor) {
  const numero = Number(valor);

  return (
    Number.isInteger(numero) &&
    numero > 0 &&
    numero <= 2147483647
  )
    ? numero
    : null;
}

function FormularioAtencion({
  citas,
  tratamientos,
  token,
  onGuardado,
  onSesionExpirada
}) {
  const [solicitar, dialogo] = useConfirmacion();
  const [citaId, setCitaId] = useState("");
  const [tratamientoId, setTratamientoId] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [indicaciones, setIndicaciones] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(evento) {
    evento.preventDefault();

    if (guardando) {
      return;
    }

    if (
      !await solicitar({ titulo: "Completar consulta", descripcion: "¿Guardar esta atención y marcar la cita como completada?", boton: "Guardar atención" })
    ) {
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const datos = await consultarApi("/api/historial/atenciones", {
        method: "POST",
        token,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          cita_id: Number(citaId),
          tratamiento_id: Number(tratamientoId),
          diagnostico,
          indicaciones,
          notas
        })
      });

      onGuardado(datos.mensaje);
    } catch (fallo) {
      if (fallo.status === 401) {
        onSesionExpirada();
      } else {
        setError(fallo.message);
      }
    } finally {
      setGuardando(false);
    }
  }

  if (citas.length === 0) {
    return (
      <p className="mensaje mensaje-aviso">
        Este paciente no tiene citas confirmadas pendientes de
        atención contigo.
      </p>
    );
  }

  return (
    <>{dialogo}
    <form
      className="tarjeta formulario-paciente formulario-atencion"
      onSubmit={guardar}
      aria-busy={guardando}
    >
      <h2>Registrar atención</h2>

      <fieldset disabled={guardando}>
        <legend className="solo-lectores">
          Datos de la atención
        </legend>

        <div className="campo">
          <label htmlFor="cita-atencion">Cita confirmada *</label>
          <select
            id="cita-atencion"
            value={citaId}
            onChange={(evento) => setCitaId(evento.target.value)}
            required
          >
            <option value="">Selecciona una cita</option>
            {citas.map((cita) => (
              <option
                key={cita.id}
                value={cita.id}
                disabled={!cita.puede_atender}
              >
                {fechaHora(cita.fecha_hora)} — {cita.motivo}
                {!cita.puede_atender ? " — Aún no es la hora" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="tratamiento-atencion">Tratamiento *</label>
          <select
            id="tratamiento-atencion"
            value={tratamientoId}
            onChange={(evento) => setTratamientoId(evento.target.value)}
            required
          >
            <option value="">Selecciona un tratamiento</option>
            {tratamientos.map((tratamiento) => (
              <option key={tratamiento.id} value={tratamiento.id}>
                {tratamiento.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="diagnostico-atencion">Diagnóstico *</label>
          <textarea
            id="diagnostico-atencion"
            rows={4}
            maxLength={5000}
            value={diagnostico}
            onChange={(evento) => setDiagnostico(evento.target.value)}
            required
          />
        </div>

        <div className="campo">
          <label htmlFor="indicaciones-atencion">
            Indicaciones y seguimiento *
          </label>
          <textarea
            id="indicaciones-atencion"
            rows={4}
            maxLength={5000}
            value={indicaciones}
            onChange={(evento) => setIndicaciones(evento.target.value)}
            required
          />
        </div>

        <div className="campo">
          <label htmlFor="notas-atencion">Notas adicionales</label>
          <textarea
            id="notas-atencion"
            rows={3}
            maxLength={5000}
            value={notas}
            onChange={(evento) => setNotas(evento.target.value)}
          />
        </div>

        {error && (
          <p className="mensaje mensaje-error" role="alert">
            {error}
          </p>
        )}

        <div className="acciones-formulario">
          <button
            type="submit"
            className="boton-principal boton-ajustado"
            disabled={tratamientos.length === 0}
          >
            {guardando
              ? "Guardando atención..."
              : "Guardar y completar cita"}
          </button>
        </div>
      </fieldset>
    </form>
    </>
  );
}

export default function Historial({
  sesion,
  onSesionExpirada,
  pacienteIdInicial = null
}) {
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revision, setRevision] = useState(0);

  const [pacienteId, setPacienteId] = useState(() =>
    identificadorValido(pacienteIdInicial)
  );

  const [listado, setListado] = useState({
    pacientes: [],
    total_paginas: 1
  });

  const [detalle, setDetalle] = useState(null);
  const [tratamientos, setTratamientos] = useState([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorLista, setErrorLista] = useState("");
  const [errorDetalle, setErrorDetalle] = useState("");
  const [aviso, setAviso] = useState("");

  const esDoctor = sesion.usuario.rol === "doctor";

  useEffect(() => {
    if (pacienteId !== null) {
      return undefined;
    }

    let vigente = true;

    async function cargarLista() {
      setCargandoLista(true);
      setErrorLista("");

      try {
        const parametros = new URLSearchParams({
          buscar: filtro,
          pagina: String(pagina)
        });

        const datos = await consultarApi(
          `/api/historial/pacientes?${parametros}`,
          { token: sesion.token }
        );

        if (vigente) {
          setListado(datos);
        }
      } catch (error) {
        if (!vigente) {
          return;
        }

        if (error.status === 401) {
          onSesionExpirada();
        } else {
          setErrorLista(error.message);
        }
      } finally {
        if (vigente) {
          setCargandoLista(false);
        }
      }
    }

    void cargarLista();

    return () => {
      vigente = false;
    };
  }, [
    pacienteId,
    filtro,
    pagina,
    revision,
    sesion.token,
    onSesionExpirada
  ]);

  useEffect(() => {
    if (pacienteId === null) {
      return undefined;
    }

    let vigente = true;

    async function cargarDetalle() {
      setCargandoDetalle(true);
      setErrorDetalle("");
      setDetalle(null);
      setTratamientos([]);

      try {
        const [expediente, catalogo] = await Promise.all([
          consultarApi(`/api/historial/pacientes/${pacienteId}`, {
            token: sesion.token
          }),
          esDoctor
            ? consultarApi("/api/historial/tratamientos", {
                token: sesion.token
              })
            : Promise.resolve({ tratamientos: [] })
        ]);

        if (vigente) {
          setDetalle(expediente);
          setTratamientos(catalogo.tratamientos);
        }
      } catch (error) {
        if (!vigente) {
          return;
        }

        if (error.status === 401) {
          onSesionExpirada();
        } else {
          setErrorDetalle(error.message);
        }
      } finally {
        if (vigente) {
          setCargandoDetalle(false);
        }
      }
    }

    void cargarDetalle();

    return () => {
      vigente = false;
    };
  }, [
    pacienteId,
    revision,
    sesion.token,
    esDoctor,
    onSesionExpirada
  ]);

  function ejecutarBusqueda(evento) {
    evento.preventDefault();
    setFiltro(buscar.trim());
    setPagina(1);
    setRevision((actual) => actual + 1);
  }

  function abrirPaciente(id) {
    const identificador = identificadorValido(id);

    if (identificador === null) {
      return;
    }

    setDetalle(null);
    setErrorDetalle("");
    setAviso("");
    setCargandoDetalle(true);
    setPacienteId(identificador);
  }

  function volverAlListado() {
    setDetalle(null);
    setTratamientos([]);
    setErrorDetalle("");
    setAviso("");
    setCargandoDetalle(false);
    setCargandoLista(true);
    setPacienteId(null);
  }

  const detalleVisible =
    pacienteId !== null &&
    Number(detalle?.paciente?.id) === pacienteId
      ? detalle
      : null;

  return (
    <section className="modulo-historial">
      <header className="cabecera-modulo">
        <div>
          <h1>Historial clínico</h1>
          <p className="descripcion">
            Expedientes, tratamientos y atenciones
          </p>
        </div>

        <div className="acciones-cabecera">
          {pacienteId !== null && (
            <button
              type="button"
              className="boton-secundario"
              onClick={volverAlListado}
            >
              Volver a pacientes
            </button>
          )}

          <button
            type="button"
            className="boton-secundario"
            disabled={
              pacienteId === null ? cargandoLista : cargandoDetalle
            }
            onClick={() => setRevision((actual) => actual + 1)}
          >
            Actualizar
          </button>
        </div>
      </header>

      {pacienteId === null && (
        <>
          <form
            className="buscador-pacientes buscador-historial"
            onSubmit={ejecutarBusqueda}
          >
            <label className="solo-lectores" htmlFor="buscar-historial">
              Buscar paciente
            </label>
            <input
              id="buscar-historial"
              value={buscar}
              onChange={(evento) => setBuscar(evento.target.value)}
              maxLength={150}
              placeholder="Buscar paciente por nombre..."
            />
            <button type="submit" className="boton-secundario">
              Buscar
            </button>
          </form>

          {errorLista && (
            <p className="mensaje mensaje-error" role="alert">
              {errorLista}
            </p>
          )}

          {!errorLista && (
            <>
              <div
                className="selector-expedientes"
                aria-busy={cargandoLista}
              >
                {cargandoLista ? (
                  <p className="descripcion">Cargando pacientes...</p>
                ) : listado.pacientes.length === 0 ? (
                  <p className="mensaje mensaje-aviso">
                    No hay pacientes disponibles con ese criterio.
                    {esDoctor &&
                      " Deben tener una cita confirmada o completada contigo."}
                  </p>
                ) : (
                  listado.pacientes.map((paciente) => (
                    <button
                      key={paciente.id}
                      type="button"
                      className="selector-expediente"
                      onClick={() => abrirPaciente(paciente.id)}
                    >
                      <strong>{paciente.nombre}</strong>
                      <span>
                        ID {paciente.id} ·{" "}
                        {paciente.telefono || "Sin teléfono"}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="paginacion-historial">
                <button
                  type="button"
                  className="boton-secundario"
                  disabled={cargandoLista || pagina === 1}
                  onClick={() => setPagina((actual) => actual - 1)}
                >
                  Anterior
                </button>

                <span>
                  Página {pagina} de {listado.total_paginas}
                </span>

                <button
                  type="button"
                  className="boton-secundario"
                  disabled={
                    cargandoLista || pagina >= listado.total_paginas
                  }
                  onClick={() => setPagina((actual) => actual + 1)}
                >
                  Siguiente
                </button>
              </div>
            </>
          )}
        </>
      )}

      {pacienteId !== null && (
        <>
          {aviso && (
            <p className="mensaje mensaje-aviso" role="status">
              {aviso}
            </p>
          )}

          {errorDetalle && (
            <div className="mensaje mensaje-error" role="alert">
              <p>{errorDetalle}</p>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => setRevision((actual) => actual + 1)}
              >
                Reintentar
              </button>
            </div>
          )}

          {cargandoDetalle && (
            <p className="descripcion" role="status">
              Cargando expediente...
            </p>
          )}

          {detalleVisible && !cargandoDetalle && (
            <>
              <section className="tarjeta ficha-expediente">
                <div className="cabecera-expediente">
                  <div>
                    <h2>{detalleVisible.paciente.nombre}</h2>
                    <p className="descripcion">
                      ID del paciente: {detalleVisible.paciente.id}
                    </p>
                  </div>

                  <span
                    className={`estado ${detalleVisible.paciente.estado}`}
                  >
                    {detalleVisible.paciente.estado}
                  </span>
                </div>

                <dl className="datos-cuenta">
                  <div>
                    <dt>Fecha de nacimiento</dt>
                    <dd>
                      {fechaNacimiento(
                        detalleVisible.paciente.fecha_nacimiento
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Teléfono</dt>
                    <dd>
                      {detalleVisible.paciente.telefono || "Sin registrar"}
                    </dd>
                  </div>
                  <div>
                    <dt>Correo electrónico</dt>
                    <dd>
                      {detalleVisible.paciente.email || "Sin registrar"}
                    </dd>
                  </div>
                </dl>

                <div className="antecedentes-expediente">
                  <h3>Antecedentes registrados</h3>
                  <p>
                    {detalleVisible.paciente.antecedentes ||
                      "No se han registrado antecedentes."}
                  </p>

                  {detalleVisible.paciente.alergias && (
                    <>
                      <h3>Alergias</h3>
                      <p>{detalleVisible.paciente.alergias}</p>
                    </>
                  )}
                </div>
              </section>

              <h2 className="titulo-seccion-historial">
                Atenciones anteriores
              </h2>

              {detalleVisible.historial.length === 0 ? (
                <p className="mensaje mensaje-aviso">
                  Este paciente todavía no tiene atenciones registradas.
                </p>
              ) : (
                <div className="lista-atenciones">
                  {detalleVisible.historial.map((registro) => (
                    <article
                      className="tarjeta registro-atencion"
                      key={registro.id}
                    >
                      <header>
                        <div>
                          <strong>
                            {registro.tratamiento || "Atención médica"}
                          </strong>
                          <p className="descripcion">
                            Registro: {fechaHora(registro.fecha)}
                          </p>
                        </div>
                        <span className="descripcion">
                          {registro.doctor}
                        </span>
                      </header>

                      <h3>Diagnóstico</h3>
                      <p>{registro.diagnostico}</p>

                      <h3>Indicaciones y seguimiento</h3>
                      <p>
                        {registro.indicaciones ||
                          "Sin indicaciones registradas."}
                      </p>

                      {registro.notas && (
                        <>
                          <h3>Notas</h3>
                          <p>{registro.notas}</p>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              )}

              {esDoctor && (
                <FormularioAtencion
                  key={`${detalleVisible.paciente.id}-${revision}`}
                  citas={detalleVisible.citas}
                  tratamientos={tratamientos}
                  token={sesion.token}
                  onSesionExpirada={onSesionExpirada}
                  onGuardado={(mensaje) => {
                    setAviso(mensaje);
                    setRevision((actual) => actual + 1);
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
