import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import Agenda from "./Agenda.jsx";
import Historial from "./Historial.jsx";
import Cobros from "./Cobros.jsx";
import Dashboard from "./Dashboard.jsx";
import "./panel.css";

const roles = {
  admin: "Administrador",
  recepcionista: "Recepcionista",
  doctor: "Doctor",
  paciente: "Paciente"
};

const estados = {
  activo: "Activo",
  tratamiento: "Tratamiento",
  inactivo: "Inactivo"
};

const formularioVacio = {
  nombre: "",
  fecha_nacimiento: "",
  telefono: "",
  email: "",
  direccion: "",
  antecedentes: ""
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
    </svg>
  );
}

export default function Panel({
  sesion,
  onCerrarSesion,
  onSesionExpirada
}) {
  const puedeGestionar = ["admin", "recepcionista"].includes(
    sesion.usuario.rol
  );

  const puedeVerHistorial = ["admin", "doctor"].includes(
    sesion.usuario.rol
  );

  const [vista, setVista] = useState(
    sesion.usuario.rol === "doctor"
      ? "historial"
      : puedeGestionar
        ? "dashboard"
        : "inicio"
  );

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
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const [formulario, setFormulario] = useState({
    ...formularioVacio
  });

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

    cargar();

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
    setError("");
    setAviso("");
    setVista(destino);
  }

  function buscar(evento) {
    evento.preventDefault();
    setPagina(1);
    setFiltro(busqueda.trim());
    setRevision((actual) => actual + 1);
    setAviso("");
  }

  async function guardarPaciente(evento) {
    evento.preventDefault();

    if (guardando) {
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const respuesta = await consultarApi("/api/pacientes", {
        method: "POST",
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
        `Paciente ${respuesta.paciente.nombre} registrado correctamente.`
      );

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

  const menu = [
    {
      id: "inicio",
      texto: "Inicio",
      habilitado: true
    },
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
    {
      id: "agenda",
      texto: "Agenda",
      habilitado: puedeGestionar
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
              (vista === "nuevo" && item.id === "pacientes");

            return (
              <button
                key={item.id}
                type="button"
                className={`opcion-menu ${seleccionado ? "activa" : ""}`}
                disabled={!item.habilitado || guardando}
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

          <span>
            {roles[sesion.usuario.rol] || sesion.usuario.rol}
          </span>

          <button
            type="button"
            className="boton-secundario"
            onClick={onCerrarSesion}
            disabled={guardando}
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

        {vista === "agenda" && puedeGestionar && (
          <Agenda
            token={sesion.token}
            onSesionExpirada={onSesionExpirada}
          />
        )}

        {vista === "historial" && puedeVerHistorial && (
          <Historial
            sesion={sesion}
            onSesionExpirada={onSesionExpirada}
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
                <form
                  className="buscador-pacientes"
                  onSubmit={buscar}
                >
                  <label
                    className="solo-lectores"
                    htmlFor="buscar"
                  >
                    Buscar paciente por nombre
                  </label>

                  <input
                    id="buscar"
                    type="search"
                    placeholder="Buscar paciente por nombre..."
                    maxLength={150}
                    value={busqueda}
                    onChange={(evento) =>
                      setBusqueda(evento.target.value)
                    }
                  />

                  <button
                    type="submit"
                    className="boton-secundario"
                  >
                    Buscar
                  </button>
                </form>

                <button
                  type="button"
                  className="boton-principal boton-ajustado"
                  onClick={() => {
                    setFormulario({ ...formularioVacio });
                    cambiarVista("nuevo");
                  }}
                >
                  + Nuevo paciente
                </button>
              </div>
            </header>

            {aviso && (
              <p
                className="mensaje mensaje-aviso"
                role="status"
              >
                {aviso}
              </p>
            )}

            {error && (
              <div
                className="mensaje mensaje-error"
                role="alert"
              >
                <p>{error}</p>

                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() =>
                    setRevision((actual) => actual + 1)
                  }
                >
                  Reintentar
                </button>
              </div>
            )}

            {!error && (
              <section className="tarjeta listado-pacientes">
                <div
                  className="tabla-desplazable"
                  aria-busy={cargando}
                >
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
                      </tr>
                    </thead>

                    <tbody>
                      {cargando ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="estado-tabla"
                          >
                            Cargando pacientes...
                          </td>
                        </tr>
                      ) : datos.pacientes.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="estado-tabla"
                          >
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

                            <td>
                              {paciente.telefono || "Sin teléfono"}
                            </td>

                            <td>
                              {paciente.email || "Sin correo"}
                            </td>

                            <td>
                              {fechaVisita(paciente.ultima_visita)}
                            </td>

                            <td>
                              <span
                                className={`estado ${paciente.estado}`}
                              >
                                {estados[paciente.estado]}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <footer className="paginacion">
                  <span>
                    {datos.total} pacientes encontrados
                  </span>

                  <div>
                    <button
                      type="button"
                      className="boton-secundario"
                      disabled={cargando || pagina === 1}
                      onClick={() =>
                        setPagina((actual) => actual - 1)
                      }
                    >
                      Anterior
                    </button>

                    <span>
                      Página {pagina} de {datos.total_paginas}
                    </span>

                    <button
                      type="button"
                      className="boton-secundario"
                      disabled={
                        cargando ||
                        pagina >= datos.total_paginas
                      }
                      onClick={() =>
                        setPagina((actual) => actual + 1)
                      }
                    >
                      Siguiente
                    </button>
                  </div>
                </footer>
              </section>
            )}
          </>
        )}

        {vista === "nuevo" && puedeGestionar && (
          <>
            <header className="cabecera-modulo">
              <div>
                <h1>Registrar nuevo paciente</h1>

                <p className="descripcion">
                  Crear una nueva ficha de expediente clínico
                </p>
              </div>
            </header>

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
                      className={
                        `campo ${campo.ancho ? "ancho-completo" : ""}`
                      }
                    >
                      <label
                        htmlFor={`paciente-${campo.nombre}`}
                      >
                        {campo.etiqueta}
                      </label>

                      <input
                        id={`paciente-${campo.nombre}`}
                        name={campo.nombre}
                        type={campo.tipo}
                        value={formulario[campo.nombre]}
                        onChange={(evento) =>
                          setFormulario((actual) => ({
                            ...actual,
                            [campo.nombre]: evento.target.value
                          }))
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
                        setFormulario((actual) => ({
                          ...actual,
                          antecedentes: evento.target.value
                        }))
                      }
                      placeholder="Antecedentes relevantes, alergias o condiciones conocidas..."
                    />
                  </div>
                </div>

                <p className="descripcion">
                  * Campos obligatorios.
                </p>

                {error && (
                  <p
                    className="mensaje mensaje-error"
                    role="alert"
                  >
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
                      : "Guardar paciente"}
                  </button>
                </div>
              </fieldset>
            </form>
          </>
        )}
      </main>
    </div>
  );
}