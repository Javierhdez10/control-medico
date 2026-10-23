import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./doctores.css";

const diasSemana = [
  { numero: 1, nombre: "Lunes" },
  { numero: 2, nombre: "Martes" },
  { numero: 3, nombre: "Miércoles" },
  { numero: 4, nombre: "Jueves" },
  { numero: 5, nombre: "Viernes" },
  { numero: 6, nombre: "Sábado" },
  { numero: 7, nombre: "Domingo" }
];

function crearFormularioVacio() {
  return {
    nombre: "",
    email: "",
    telefono: "",
    especialidad: "",
    licencia: "",
    password: "",
    confirmacion: "",
    dias: [1, 2, 3, 4, 5],
    hora_inicio: "08:00",
    hora_fin: "17:00"
  };
}

function nombreDia(numero) {
  return diasSemana.find((dia) => dia.numero === Number(numero))
    ?.nombre ?? "Día desconocido";
}

export default function Doctores({
  sesion,
  onSesionExpirada,
  onOcupado
}) {
  const [vista, setVista] = useState("lista");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revision, setRevision] = useState(0);

  const [datos, setDatos] = useState({
    doctores: [],
    total: 0,
    total_paginas: 1
  });

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [cargandoEdicion, setCargandoEdicion] = useState(false);
  const [edicionLista, setEdicionLista] = useState(false);
  const [doctorEditandoId, setDoctorEditandoId] = useState(null);
  const [correoOriginal, setCorreoOriginal] = useState("");

  const [errorLista, setErrorLista] = useState("");
  const [errorFormulario, setErrorFormulario] = useState("");
  const [aviso, setAviso] = useState("");
  const [horarioAbiertoId, setHorarioAbiertoId] = useState(null);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [formulario, setFormulario] = useState(crearFormularioVacio);

  const esEdicion = vista === "editar";
  const ocupado = guardando || cargandoEdicion;

  const cambiaCorreo =
    esEdicion &&
    formulario.email.trim().toLowerCase() !== correoOriginal;

  useEffect(() => {
    if (vista !== "lista") {
      return undefined;
    }

    let vigente = true;

    async function cargarDoctores() {
      setCargando(true);
      setErrorLista("");

      try {
        const parametros = new URLSearchParams({
          buscar: filtro,
          pagina: String(pagina)
        });

        const respuesta = await consultarApi(
          `/api/doctores?${parametros}`,
          { token: sesion.token }
        );

        if (vigente) {
          setDatos(respuesta);
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
          setCargando(false);
        }
      }
    }

    void cargarDoctores();

    return () => {
      vigente = false;
    };
  }, [
    vista,
    filtro,
    pagina,
    revision,
    sesion.token,
    onSesionExpirada
  ]);

  function cambiarCampo(nombre, valor) {
    setFormulario((actual) => ({
      ...actual,
      [nombre]: valor
    }));
  }

  function cambiarDia(numero) {
    setFormulario((actual) => ({
      ...actual,
      dias: actual.dias.includes(numero)
        ? actual.dias.filter((dia) => dia !== numero)
        : [...actual.dias, numero].sort((a, b) => a - b)
    }));
  }

  function buscar(evento) {
    evento.preventDefault();
    setFiltro(busqueda.trim());
    setPagina(1);
    setHorarioAbiertoId(null);
    setAviso("");
    setRevision((actual) => actual + 1);
  }

  function abrirFormulario() {
    setFormulario(crearFormularioVacio());
    setDoctorEditandoId(null);
    setCorreoOriginal("");
    setEdicionLista(false);
    setMostrarPassword(false);
    setErrorFormulario("");
    setAviso("");
    setVista("nuevo");
  }

  async function abrirEdicion(id) {
    if (ocupado) {
      return;
    }

    setVista("editar");
    setDoctorEditandoId(id);
    setFormulario(crearFormularioVacio());
    setCorreoOriginal("");
    setEdicionLista(false);
    setMostrarPassword(false);
    setErrorFormulario("");
    setAviso("");
    setCargandoEdicion(true);
    onOcupado(true);

    try {
      const respuesta = await consultarApi(
        `/api/doctores/${id}`,
        { token: sesion.token }
      );

      const doctor = respuesta.doctor;

      setFormulario({
        ...crearFormularioVacio(),
        nombre: doctor.nombre,
        email: doctor.email,
        telefono: doctor.telefono ?? "",
        especialidad: doctor.especialidad,
        licencia: doctor.licencia
      });

      setCorreoOriginal(doctor.email.trim().toLowerCase());
      setEdicionLista(true);
    } catch (error) {
      if (error.status === 401) {
        onSesionExpirada();
      } else {
        setErrorFormulario(error.message);
      }
    } finally {
      setCargandoEdicion(false);
      onOcupado(false);
    }
  }

  function cancelarFormulario() {
    if (ocupado) {
      return;
    }

    setFormulario(crearFormularioVacio());
    setDoctorEditandoId(null);
    setCorreoOriginal("");
    setEdicionLista(false);
    setMostrarPassword(false);
    setErrorFormulario("");
    setVista("lista");
  }

  async function guardarDoctor(evento) {
    evento.preventDefault();

    if (
      ocupado ||
      (esEdicion && (!edicionLista || !doctorEditandoId))
    ) {
      return;
    }

    setErrorFormulario("");

    if (
      !formulario.nombre.trim() ||
      !formulario.especialidad.trim() ||
      !formulario.licencia.trim()
    ) {
      setErrorFormulario(
        "Completa el nombre, la especialidad y la licencia."
      );
      return;
    }

    if (!esEdicion) {
      if (
        formulario.password.trim().length < 12 ||
        new TextEncoder().encode(formulario.password).length > 72
      ) {
        setErrorFormulario(
          "La contraseña debe tener al menos 12 caracteres sin contar espacios al inicio o al final y no superar 72 bytes."
        );
        return;
      }

      if (formulario.password !== formulario.confirmacion) {
        setErrorFormulario("Las contraseñas no coinciden.");
        return;
      }

      if (formulario.dias.length === 0) {
        setErrorFormulario("Selecciona al menos un día de atención.");
        return;
      }

      if (formulario.hora_fin <= formulario.hora_inicio) {
        setErrorFormulario(
          "La hora final debe ser posterior a la hora inicial."
        );
        return;
      }
    }

    if (
      cambiaCorreo &&
      !window.confirm(
        "El doctor deberá utilizar el nuevo correo para iniciar sesión. ¿Guardar este cambio?"
      )
    ) {
      return;
    }

    setGuardando(true);
    onOcupado(true);

    try {
      const cuerpo = {
        nombre: formulario.nombre.trim(),
        email: formulario.email.trim().toLowerCase(),
        telefono: formulario.telefono.trim(),
        especialidad: formulario.especialidad.trim(),
        licencia: formulario.licencia.trim()
      };

      if (!esEdicion) {
        Object.assign(cuerpo, {
          password: formulario.password,
          dias: formulario.dias,
          hora_inicio: formulario.hora_inicio,
          hora_fin: formulario.hora_fin
        });
      }

      const ruta = esEdicion
        ? `/api/doctores/${doctorEditandoId}`
        : "/api/doctores";

      const respuesta = await consultarApi(ruta, {
        method: esEdicion ? "PUT" : "POST",
        token: sesion.token,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(cuerpo)
      });

      const mensaje = esEdicion
        ? `Datos de ${respuesta.doctor.nombre} actualizados correctamente.`
        : `${respuesta.doctor.nombre} fue registrado correctamente. Su cuenta y sus horarios ya están disponibles.`;

      setFormulario(crearFormularioVacio());
      setMostrarPassword(false);
      setDoctorEditandoId(null);
      setCorreoOriginal("");
      setEdicionLista(false);
      setBusqueda(respuesta.doctor.email);
      setFiltro(respuesta.doctor.email);
      setPagina(1);
      setHorarioAbiertoId(respuesta.doctor.id);
      setAviso(mensaje);
      setRevision((actual) => actual + 1);
      setVista("lista");
    } catch (error) {
      if (error.status === 401) {
        onSesionExpirada();
      } else {
        setErrorFormulario(error.message);
      }
    } finally {
      setGuardando(false);
      onOcupado(false);
    }
  }

  return (
    <section className="modulo-doctores">
      <header className="cabecera-modulo">
        <div>
          <h1>
            {vista === "lista"
              ? "Doctores"
              : esEdicion
                ? "Editar doctor"
                : "Registrar doctor"}
          </h1>

          <p className="descripcion">
            {vista === "lista"
              ? "Profesionales registrados y horarios de atención"
              : esEdicion
                ? `Actualizar datos del doctor ID ${doctorEditandoId}`
                : "Datos profesionales, cuenta de acceso y horario semanal"}
          </p>
        </div>

        {vista === "lista" ? (
          <button
            type="button"
            className="boton-principal boton-ajustado"
            onClick={abrirFormulario}
          >
            + Nuevo doctor
          </button>
        ) : (
          <button
            type="button"
            className="boton-secundario"
            onClick={cancelarFormulario}
            disabled={ocupado}
          >
            Volver al listado
          </button>
        )}
      </header>

      {vista === "lista" && (
        <>
          <form className="doc-buscador" onSubmit={buscar}>
            <label className="solo-lectores" htmlFor="buscar-doctor">
              Buscar doctor por nombre, correo o especialidad
            </label>

            <input
              id="buscar-doctor"
              type="search"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              maxLength={150}
              placeholder="Nombre, correo o especialidad..."
            />

            <button type="submit" className="boton-secundario">
              Buscar
            </button>

            <button
              type="button"
              className="boton-secundario"
              disabled={cargando}
              onClick={() => setRevision((actual) => actual + 1)}
            >
              Actualizar
            </button>
          </form>

          {aviso && (
            <p className="mensaje mensaje-aviso" role="status">
              {aviso}
            </p>
          )}

          {errorLista && (
            <div className="mensaje mensaje-error" role="alert">
              <p>{errorLista}</p>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => setRevision((actual) => actual + 1)}
              >
                Reintentar
              </button>
            </div>
          )}

          {!errorLista && (
            <div className="tarjeta doc-listado" aria-busy={cargando}>
              {cargando ? (
                <p className="doc-vacio" role="status">
                  Cargando doctores...
                </p>
              ) : datos.doctores.length === 0 ? (
                <p className="doc-vacio">
                  {filtro
                    ? "No se encontraron doctores con ese criterio."
                    : "Todavía no hay doctores registrados."}
                </p>
              ) : (
                datos.doctores.map((doctor) => {
                  const abierto = horarioAbiertoId === doctor.id;

                  return (
                    <article className="doc-registro" key={doctor.id}>
                      <div className="doc-registro-cabecera">
                        <div>
                          <h2>{doctor.nombre}</h2>
                          <p>{doctor.especialidad}</p>
                        </div>

                        <span
                          className={`doc-estado ${
                            doctor.disponible
                              ? "doc-estado-activo"
                              : "doc-estado-inactivo"
                          }`}
                        >
                          {doctor.disponible
                            ? "Disponible"
                            : "No disponible"}
                        </span>
                      </div>

                      <dl className="doc-datos">
                        <div>
                          <dt>Correo de acceso</dt>
                          <dd>{doctor.email}</dd>
                        </div>
                        <div>
                          <dt>Teléfono</dt>
                          <dd>{doctor.telefono || "Sin registrar"}</dd>
                        </div>
                        <div>
                          <dt>Licencia</dt>
                          <dd>{doctor.licencia}</dd>
                        </div>
                        <div>
                          <dt>Identificador</dt>
                          <dd>{doctor.id}</dd>
                        </div>
                      </dl>

                      <div className="acciones-cabecera">
                        <button
                          type="button"
                          className="boton-secundario"
                          onClick={() => abrirEdicion(doctor.id)}
                        >
                          Editar datos
                        </button>

                        <button
                          type="button"
                          className="boton-secundario"
                          aria-expanded={abierto}
                          aria-controls={`horarios-doctor-${doctor.id}`}
                          onClick={() =>
                            setHorarioAbiertoId(abierto ? null : doctor.id)
                          }
                        >
                          {abierto ? "Ocultar horarios" : "Ver horarios"}
                        </button>
                      </div>

                      <div
                        id={`horarios-doctor-${doctor.id}`}
                        hidden={!abierto}
                        className="doc-horarios"
                      >
                        {doctor.horarios.length === 0 ? (
                          <p>No tiene horarios registrados.</p>
                        ) : (
                          <ul>
                            {doctor.horarios.map((horario, indice) => (
                              <li
                                key={
                                  `${horario.dia_semana}-` +
                                  `${horario.hora_inicio}-${indice}`
                                }
                              >
                                <strong>
                                  {nombreDia(horario.dia_semana)}
                                </strong>
                                <span>
                                  {horario.hora_inicio} a {horario.hora_fin}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>
                  );
                })
              )}

              <footer className="paginacion">
                <span>{datos.total} doctores encontrados</span>
                <div>
                  <button
                    type="button"
                    className="boton-secundario"
                    disabled={cargando || pagina === 1}
                    onClick={() => {
                      setHorarioAbiertoId(null);
                      setPagina((actual) => actual - 1);
                    }}
                  >
                    Anterior
                  </button>

                  <span>
                    Página {pagina} de {datos.total_paginas}
                  </span>

                  <button
                    type="button"
                    className="boton-secundario"
                    disabled={cargando || pagina >= datos.total_paginas}
                    onClick={() => {
                      setHorarioAbiertoId(null);
                      setPagina((actual) => actual + 1);
                    }}
                  >
                    Siguiente
                  </button>
                </div>
              </footer>
            </div>
          )}
        </>
      )}

      {cargandoEdicion && (
        <p className="descripcion" role="status">
          Cargando datos del doctor...
        </p>
      )}

      {esEdicion && !edicionLista && !cargandoEdicion && errorFormulario && (
        <div className="mensaje mensaje-error" role="alert">
          <p>{errorFormulario}</p>
          <button
            type="button"
            className="boton-secundario"
            onClick={() => abrirEdicion(doctorEditandoId)}
          >
            Reintentar
          </button>
        </div>
      )}

      {(vista === "nuevo" || (esEdicion && edicionLista)) && (
        <form
          className="tarjeta formulario-paciente doc-formulario"
          onSubmit={guardarDoctor}
          aria-busy={guardando}
        >
          <fieldset disabled={guardando}>
            <legend className="solo-lectores">
              Datos del doctor
            </legend>

            <h2>Datos del profesional</h2>

            <div className="rejilla-formulario">
              {[
                ["nombre", "Nombre completo *", "text", 150],
                ["email", "Correo de acceso *", "email", 254],
                ["telefono", "Teléfono", "tel", 25],
                ["especialidad", "Especialidad *", "text", 120],
                ["licencia", "Licencia profesional *", "text", 60]
              ].map(([nombre, etiqueta, tipo, maximo]) => (
                <div className="campo" key={nombre}>
                  <label htmlFor={`doctor-${nombre}`}>
                    {etiqueta}
                  </label>
                  <input
                    id={`doctor-${nombre}`}
                    name={nombre}
                    type={tipo}
                    value={formulario[nombre]}
                    onChange={(evento) =>
                      cambiarCampo(nombre, evento.target.value)
                    }
                    maxLength={maximo}
                    required={nombre !== "telefono"}
                  />
                </div>
              ))}
            </div>

            {esEdicion ? (
              <div className="mensaje mensaje-aviso">
                <p>
                  Esta edición conserva la contraseña y los horarios
                  actuales del doctor.
                </p>

                {cambiaCorreo && (
                  <p>
                    Al guardar, el doctor deberá iniciar sesión con
                    el nuevo correo.
                  </p>
                )}
              </div>
            ) : (
              <>
                <h2 className="doc-titulo-seccion">
                  Cuenta de acceso
                </h2>

                <p className="descripcion">
                  El doctor iniciará sesión con el correo indicado y
                  esta contraseña. Utiliza al menos 12 caracteres.
                </p>

                <div className="rejilla-formulario">
                  <div className="campo">
                    <label htmlFor="doctor-password">
                      Contraseña *
                    </label>
                    <input
                      id="doctor-password"
                      type={mostrarPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={formulario.password}
                      onChange={(evento) =>
                        cambiarCampo("password", evento.target.value)
                      }
                      minLength={12}
                      required
                    />
                  </div>

                  <div className="campo">
                    <label htmlFor="doctor-confirmacion">
                      Repetir contraseña *
                    </label>
                    <input
                      id="doctor-confirmacion"
                      type={mostrarPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={formulario.confirmacion}
                      onChange={(evento) =>
                        cambiarCampo("confirmacion", evento.target.value)
                      }
                      minLength={12}
                      required
                    />
                  </div>
                </div>

                <label className="doc-checkbox">
                  <input
                    type="checkbox"
                    checked={mostrarPassword}
                    onChange={(evento) =>
                      setMostrarPassword(evento.target.checked)
                    }
                  />
                  Mostrar contraseñas
                </label>

                <h2 className="doc-titulo-seccion">
                  Horario semanal
                </h2>

                <p className="descripcion">
                  El mismo intervalo se aplicará a todos los días
                  seleccionados. Horas de El Salvador.
                </p>

                <div
                  className="doc-dias"
                  role="group"
                  aria-label="Días de atención"
                >
                  {diasSemana.map((dia) => (
                    <label className="doc-dia" key={dia.numero}>
                      <input
                        type="checkbox"
                        checked={formulario.dias.includes(dia.numero)}
                        onChange={() => cambiarDia(dia.numero)}
                      />
                      <span>{dia.nombre}</span>
                    </label>
                  ))}
                </div>

                <div className="rejilla-formulario">
                  <div className="campo">
                    <label htmlFor="doctor-hora-inicio">
                      Hora de inicio *
                    </label>
                    <input
                      id="doctor-hora-inicio"
                      type="time"
                      step="60"
                      value={formulario.hora_inicio}
                      onChange={(evento) =>
                        cambiarCampo("hora_inicio", evento.target.value)
                      }
                      required
                    />
                  </div>

                  <div className="campo">
                    <label htmlFor="doctor-hora-fin">
                      Hora de finalización *
                    </label>
                    <input
                      id="doctor-hora-fin"
                      type="time"
                      step="60"
                      value={formulario.hora_fin}
                      onChange={(evento) =>
                        cambiarCampo("hora_fin", evento.target.value)
                      }
                      required
                    />
                  </div>
                </div>
              </>
            )}

            <p className="descripcion">* Campos obligatorios.</p>

            {errorFormulario && (
              <p className="mensaje mensaje-error" role="alert">
                {errorFormulario}
              </p>
            )}

            <div className="acciones-formulario">
              <button
                type="button"
                className="boton-secundario"
                onClick={cancelarFormulario}
              >
                Cancelar
              </button>

              <button
                type="submit"
                className="boton-principal boton-ajustado"
              >
                {guardando
                  ? "Guardando..."
                  : esEdicion
                    ? "Guardar cambios"
                    : "Crear doctor y horarios"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}