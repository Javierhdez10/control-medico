import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import Agenda from "./Agenda.jsx";
import AgendaDoctor from "./AgendaDoctor.jsx";
import Historial from "./Historial.jsx";
import Cobros from "./Cobros.jsx";
import Dashboard from "./Dashboard.jsx";
import Doctores from "./Doctores.jsx";
import "./panel.css";

const roles = {
  admin: "Administrador",
  recepcionista: "Recepcionista",
  doctor: "Doctor",
  paciente: "Paciente"
};

const estados = {
  activo: "Activo",
  tratamiento: "En tratamiento",
  inactivo: "Inactivo"
};

const formularioVacio = {
  nombre: "",
  fecha_nacimiento: "",
  telefono: "",
  email: "",
  direccion: "",
  antecedentes: "",
  estado: "activo"
};

function hoy() {
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

function fechaVisita(valor) {
  if (!valor) {
    return "Sin visitas";
  }

  return new Intl.DateTimeFormat("es-SV", {
    timeZone: "America/El_Salvador",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(valor));
}

function Icono({ nombre }) {
  const trazos = {
    inicio: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    dashboard: "M5 20V10M12 20V4M19 20v-7",
    pacientes:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    doctores:
      "M8 3H5v6a5 5 0 0 0 10 0V3h-3M10 14v3a4 4 0 0 0 8 0v-2",
    agenda: "M8 2v4M16 2v4M3 10h18M3 5h18v17H3z",
    historial: "M14 2H4v20h16V8zM14 2v6h6M8 13h8M8 17h6",
    cobros: "M2 5h20v14H2zM2 9h20M6 15h4"
  };

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={trazos[nombre]} />
      {nombre === "pacientes" && <circle cx="9" cy="7" r="4" />}
      {nombre === "doctores" && <circle cx="18" cy="13" r="2" />}
    </svg>
  );
}

export default function Panel({
  sesion,
  onCerrarSesion,
  onSesionExpirada
}) {
  const esAdmin = sesion.usuario.rol === "admin";
  const esDoctor = sesion.usuario.rol === "doctor";

  const puedeGestionar = ["admin", "recepcionista"].includes(
    sesion.usuario.rol
  );

  const puedeVerHistorial = ["admin", "doctor"].includes(
    sesion.usuario.rol
  );

  const [vista, setVista] = useState(
    esDoctor ? "agenda" : puedeGestionar ? "dashboard" : "inicio"
  );

  const [accesoHistorial, setAccesoHistorial] = useState({
    pacienteId: null,
    clave: 0
  });

  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revision, setRevision] = useState(0);

  const [datos, setDatos] = useState({
    pacientes: [],
    total: 0,
    total_paginas: 1
  });

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [cargandoEdicion, setCargandoEdicion] = useState(false);
  const [edicionLista, setEdicionLista] = useState(false);
  const [pacienteEditandoId, setPacienteEditandoId] = useState(null);
  const [guardandoDoctor, setGuardandoDoctor] = useState(false);

  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [formulario, setFormulario] = useState({
    ...formularioVacio
  });

  const esEdicion = vista === "editar";
  const ocupado = guardando || cargandoEdicion || guardandoDoctor;

  useEffect(() => {
    if (vista !== "pacientes" || !puedeGestionar) {
      return undefined;
    }

    let vigente = true;

    async function cargar() {
      setCargando(true);
      setError("");

      try {
        const parametros = new URLSearchParams({
          buscar: filtro,
          pagina: String(pagina)
        });

        const respuesta = await consultarApi(
          `/api/pacientes?${parametros}`,
          { token: sesion.token }
        );

        if (vigente) {
          setDatos(respuesta);
        }
      } catch (fallo) {
        if (vigente) {
          if (fallo.status === 401) {
            onSesionExpirada();
          } else {
            setError(fallo.message);
          }
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, [
    vista,
    filtro,
    pagina,
    revision,
    sesion.token,
    puedeGestionar,
    onSesionExpirada
  ]);

  function cambiarVista(destino) {
    if (ocupado) {
      return;
    }

    setError("");
    setAviso("");

    if (destino === "historial") {
      setAccesoHistorial((actual) => ({
        pacienteId: null,
        clave: actual.clave + 1
      }));
    }

    setVista(destino);
  }

  function abrirHistorialPaciente(pacienteId) {
    if (!puedeVerHistorial) {
      return;
    }

    const id = Number(pacienteId);

    if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
      return;
    }

    setError("");
    setAviso("");

    setAccesoHistorial((actual) => ({
      pacienteId: id,
      clave: actual.clave + 1
    }));

    setVista("historial");
  }

  function buscar(evento) {
    evento.preventDefault();
    setPagina(1);
    setFiltro(busqueda.trim());
    setRevision((actual) => actual + 1);
    setAviso("");
  }

  function abrirNuevoPaciente() {
    if (ocupado) {
      return;
    }

    setFormulario({ ...formularioVacio });
    setPacienteEditandoId(null);
    setEdicionLista(false);
    cambiarVista("nuevo");
  }

  async function abrirEdicion(id) {
    if (!puedeGestionar || ocupado) {
      return;
    }

    setVista("editar");
    setPacienteEditandoId(id);
    setFormulario({ ...formularioVacio });
    setEdicionLista(false);
    setCargandoEdicion(true);
    setError("");
    setAviso("");

    try {
      const respuesta = await consultarApi(
        `/api/pacientes/${id}`,
        { token: sesion.token }
      );

      const paciente = respuesta.paciente;

      setFormulario({
        nombre: paciente.nombre,
        fecha_nacimiento: paciente.fecha_nacimiento,
        telefono: paciente.telefono ?? "",
        email: paciente.email ?? "",
        direccion: paciente.direccion ?? "",
        antecedentes: paciente.antecedentes ?? "",
        estado: paciente.estado
      });

      setEdicionLista(true);
    } catch (fallo) {
      if (fallo.status === 401) {
        onSesionExpirada();
      } else {
        setError(fallo.message);
      }
    } finally {
      setCargandoEdicion(false);
    }
  }

  async function guardarPaciente(evento) {
    evento.preventDefault();

    if (
      ocupado ||
      (esEdicion && (!edicionLista || !pacienteEditandoId))
    ) {
      return;
    }

    setGuardando(true);
    setError("");

    const ruta = esEdicion
      ? `/api/pacientes/${pacienteEditandoId}`
      : "/api/pacientes";

    try {
      const respuesta = await consultarApi(ruta, {
        method: esEdicion ? "PUT" : "POST",
        token: sesion.token,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formulario)
      });

      setBusqueda("");
      setFiltro("");
      setPagina(1);
      setRevision((actual) => actual + 1);

      setAviso(
        esEdicion
          ? `Datos de ${respuesta.paciente.nombre} actualizados correctamente.`
          : `Paciente ${respuesta.paciente.nombre} registrado correctamente.`
      );

      setPacienteEditandoId(null);
      setEdicionLista(false);
      setFormulario({ ...formularioVacio });
      setVista("pacientes");
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

  function actualizarCampo(nombre, valor) {
    setFormulario((actual) => ({
      ...actual,
      [nombre]: valor
    }));
  }

  const menu = [
    { id: "inicio", texto: "Inicio", habilitado: true },
    {
      id: "dashboard",
      texto: "Dashboard",
      habilitado: puedeGestionar
    },
    {
      id: "pacientes",
      texto: "Pacientes",
      habilitado: puedeGestionar
    },
    ...(esAdmin
      ? [{ id: "doctores", texto: "Doctores", habilitado: true }]
      : []),
    {
      id: "agenda",
      texto: esDoctor ? "Mi agenda" : "Agenda",
      habilitado: puedeGestionar || esDoctor
    },
    {
      id: "historial",
      texto: "Historial",
      habilitado: puedeVerHistorial
    },
    {
      id: "cobros",
      texto: "Cobros",
      habilitado: puedeGestionar
    }
  ];

  const camposPaciente = [
    {
      nombre: "nombre",
      etiqueta: "Nombre completo *",
      tipo: "text",
      maximo: 150,
      obligatorio: true,
      autocompletar: "name"
    },
    {
      nombre: "fecha_nacimiento",
      etiqueta: "Fecha de nacimiento *",
      tipo: "date",
      obligatorio: true,
      minimo: "1900-01-01",
      maximoFecha: hoy()
    },
    {
      nombre: "telefono",
      etiqueta: "Teléfono de contacto",
      tipo: "tel",
      maximo: 25,
      autocompletar: "tel"
    },
    {
      nombre: "email",
      etiqueta: "Correo electrónico",
      tipo: "email",
      maximo: 254,
      autocompletar: "email"
    },
    {
      nombre: "direccion",
      etiqueta: "Dirección particular",
      tipo: "text",
      maximo: 500,
      ancho: true,
      autocompletar: "street-address"
    }
  ];

  return (
    <div className="panel-clinica">
      <aside className="menu-lateral">
        <div className="marca">Clínica médica</div>

        <nav className="navegacion" aria-label="Menú principal">
          {menu.map((item) => {
            const seleccionado =
              vista === item.id ||
              (
                ["nuevo", "editar"].includes(vista) &&
                item.id === "pacientes"
              );

            return (
              <button
                key={item.id}
                type="button"
                className={`opcion-menu ${seleccionado ? "activa" : ""}`}
                disabled={!item.habilitado || ocupado}
                aria-current={seleccionado ? "page" : undefined}
                onClick={() => cambiarVista(item.id)}
              >
                <Icono nombre={item.id} />
                <span>{item.texto}</span>
              </button>
            );
          })}
        </nav>

        <div className="usuario-lateral">
          <strong>{sesion.usuario.nombre}</strong>
          <span>{roles[sesion.usuario.rol] || sesion.usuario.rol}</span>
          <button
            type="button"
            className="boton-secundario"
            onClick={onCerrarSesion}
            disabled={ocupado}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="area-panel">
        {vista === "inicio" && (
          <>
            <header className="cabecera-modulo">
              <div>
                <h1>Inicio</h1>
                <p className="descripcion">
                  Tu cuenta en Control Médico
                </p>
              </div>
            </header>
            <section className="tarjeta tarjeta-sesion">
              <h2>Bienvenido, {sesion.usuario.nombre}</h2>
              <dl className="datos-cuenta">
                <div>
                  <dt>Correo</dt>
                  <dd>{sesion.usuario.email}</dd>
                </div>
                <div>
                  <dt>Rol</dt>
                  <dd>{roles[sesion.usuario.rol]}</dd>
                </div>
              </dl>
            </section>
          </>
        )}

        {vista === "dashboard" && puedeGestionar && (
          <Dashboard
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
          />
        )}

        {vista === "doctores" && esAdmin && (
          <Doctores
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
            onOcupado={setGuardandoDoctor}
          />
        )}

        {vista === "agenda" && puedeGestionar && (
          <Agenda
            token={sesion.token}
            onSesionExpirada={onSesionExpirada}
          />
        )}

        {vista === "agenda" && esDoctor && (
          <AgendaDoctor
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
            onAbrirHistorial={abrirHistorialPaciente}
          />
        )}

        {vista === "historial" && puedeVerHistorial && (
          <Historial
            key={accesoHistorial.clave}
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
            pacienteIdInicial={accesoHistorial.pacienteId}
          />
        )}

        {vista === "cobros" && puedeGestionar && (
          <Cobros
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
          />
        )}

        {vista === "pacientes" && puedeGestionar && (
          <>
            <header className="cabecera-modulo">
              <div>
                <h1>Pacientes</h1>
                <p className="descripcion">
                  Base de datos y expediente clínico
                </p>
              </div>

              <div className="acciones-cabecera">
                <form className="buscador-pacientes" onSubmit={buscar}>
                  <label className="solo-lectores" htmlFor="buscar">
                    Buscar paciente por nombre
                  </label>
                  <input
                    id="buscar"
                    type="search"
                    placeholder="Buscar paciente por nombre..."
                    maxLength={150}
                    value={busqueda}
                    onChange={(evento) => setBusqueda(evento.target.value)}
                  />
                  <button type="submit" className="boton-secundario">
                    Buscar
                  </button>
                </form>

                <button
                  type="button"
                  className="boton-principal boton-ajustado"
                  onClick={abrirNuevoPaciente}
                >
                  + Nuevo paciente
                </button>
              </div>
            </header>

            {aviso && (
              <p className="mensaje mensaje-aviso" role="status">
                {aviso}
              </p>
            )}

            {error && (
              <div className="mensaje mensaje-error" role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() => setRevision((actual) => actual + 1)}
                >
                  Reintentar
                </button>
              </div>
            )}

            {!error && (
              <section className="tarjeta listado-pacientes">
                <div className="tabla-desplazable" aria-busy={cargando}>
                  <table className="tabla-pacientes">
                    <caption className="solo-lectores">
                      Pacientes registrados
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Nombre</th>
                        <th scope="col">Teléfono</th>
                        <th scope="col">Email</th>
                        <th scope="col">Última visita</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando ? (
                        <tr>
                          <td colSpan={6} className="estado-tabla">
                            Cargando pacientes...
                          </td>
                        </tr>
                      ) : datos.pacientes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="estado-tabla">
                            {filtro
                              ? "No se encontraron pacientes con ese nombre."
                              : "Todavía no hay pacientes registrados."}
                          </td>
                        </tr>
                      ) : (
                        datos.pacientes.map((paciente) => (
                          <tr key={paciente.id}>
                            <td className="nombre-paciente">
                              {paciente.nombre}
                            </td>
                            <td>{paciente.telefono || "Sin teléfono"}</td>
                            <td>{paciente.email || "Sin correo"}</td>
                            <td>{fechaVisita(paciente.ultima_visita)}</td>
                            <td>
                              <span className={`estado ${paciente.estado}`}>
                                {estados[paciente.estado]}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="boton-secundario"
                                onClick={() => abrirEdicion(paciente.id)}
                                aria-label={`Editar a ${paciente.nombre}`}
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <footer className="paginacion">
                  <span>{datos.total} pacientes encontrados</span>
                  <div>
                    <button
                      type="button"
                      className="boton-secundario"
                      disabled={cargando || pagina === 1}
                      onClick={() => setPagina((actual) => actual - 1)}
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
                      onClick={() => setPagina((actual) => actual + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </footer>
              </section>
            )}
          </>
        )}

        {["nuevo", "editar"].includes(vista) && puedeGestionar && (
          <>
            <header className="cabecera-modulo">
              <div>
                <h1>
                  {esEdicion
                    ? "Editar paciente"
                    : "Registrar nuevo paciente"}
                </h1>
                <p className="descripcion">
                  {esEdicion
                    ? `Actualizar los datos del paciente ID ${pacienteEditandoId}`
                    : "Crear una nueva ficha de expediente clínico"}
                </p>
              </div>

              <button
                type="button"
                className="boton-secundario"
                disabled={ocupado}
                onClick={() => cambiarVista("pacientes")}
              >
                Volver a pacientes
              </button>
            </header>

            {cargandoEdicion && (
              <p className="descripcion" role="status">
                Cargando datos del paciente...
              </p>
            )}

            {esEdicion && !edicionLista && !cargandoEdicion && error && (
              <div className="mensaje mensaje-error" role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() => abrirEdicion(pacienteEditandoId)}
                >
                  Reintentar
                </button>
              </div>
            )}

            {(!esEdicion || edicionLista) && (
              <form
                className="tarjeta formulario-paciente"
                onSubmit={guardarPaciente}
                aria-busy={guardando}
              >
                <fieldset disabled={guardando}>
                  <legend className="solo-lectores">
                    Datos del paciente
                  </legend>

                  <div className="rejilla-formulario">
                    {camposPaciente.map((campo) => (
                      <div
                        key={campo.nombre}
                        className={`campo ${campo.ancho ? "ancho-completo" : ""}`}
                      >
                        <label htmlFor={`paciente-${campo.nombre}`}>
                          {campo.etiqueta}
                        </label>
                        <input
                          id={`paciente-${campo.nombre}`}
                          name={campo.nombre}
                          type={campo.tipo}
                          value={formulario[campo.nombre]}
                          onChange={(evento) =>
                            actualizarCampo(campo.nombre, evento.target.value)
                          }
                          maxLength={campo.maximo}
                          min={campo.minimo}
                          max={campo.maximoFecha}
                          required={campo.obligatorio}
                          autoComplete={campo.autocompletar}
                        />
                      </div>
                    ))}

                    <div className="campo ancho-completo">
                      <label htmlFor="antecedentes">
                        Notas médicas y antecedentes
                      </label>
                      <textarea
                        id="antecedentes"
                        rows={5}
                        maxLength={5000}
                        value={formulario.antecedentes}
                        onChange={(evento) =>
                          actualizarCampo("antecedentes", evento.target.value)
                        }
                        placeholder="Antecedentes relevantes, alergias o condiciones conocidas..."
                      />
                    </div>

                    {esEdicion && (
                      <div className="campo ancho-completo">
                        <label htmlFor="estado-paciente">
                          Estado del paciente *
                        </label>
                        <select
                          id="estado-paciente"
                          value={formulario.estado}
                          onChange={(evento) =>
                            actualizarCampo("estado", evento.target.value)
                          }
                          required
                          style={{
                            width: "100%",
                            padding: "12px",
                            border: "1px solid #dbe3ed",
                            borderRadius: "8px",
                            background: "#ffffff",
                            color: "#263247",
                            font: "inherit"
                          }}
                        >
                          <option value="activo">Activo</option>
                          <option value="tratamiento">En tratamiento</option>
                          <option value="inactivo">Inactivo</option>
                        </select>
                        <p className="descripcion">
                          Un paciente inactivo no podrá recibir nuevas citas.
                          Sus citas existentes e historial se conservan.
                        </p>
                      </div>
                    )}
                  </div>

                  <p className="descripcion">* Campos obligatorios.</p>

                  {error && (
                    <p className="mensaje mensaje-error" role="alert">
                      {error}
                    </p>
                  )}

                  <div className="acciones-formulario">
                    <button
                      type="button"
                      className="boton-secundario"
                      onClick={() => cambiarVista("pacientes")}
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
                          : "Guardar paciente"}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}