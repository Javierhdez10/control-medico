import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./cobros.css";

function dinero(valor) {
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD"
  }).format(Number(valor || 0));
}

function fechaHora(valor) {
  return new Intl.DateTimeFormat("es-SV", {
    timeZone: "America/El_Salvador",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(valor));
}

function estadoCuenta(cuenta) {
  if (Number(cuenta.saldo) <= 0) {
    return "Pagado";
  }

  return Number(cuenta.total_pagado) > 0 ? "Parcial" : "Pendiente";
}

function leerOperacion(clave) {
  try {
    const texto = sessionStorage.getItem(clave);
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

export default function Cobros({
  sesion,
  onSesionExpirada
}) {
  const claveLocal = `control_medico_pago_${sesion.usuario.id}`;

  const [pendiente, setPendiente] = useState(
    () => leerOperacion(claveLocal)
  );

  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revision, setRevision] = useState(0);
  const [citaId, setCitaId] = useState(null);

  const [datos, setDatos] = useState({
    cuentas: [],
    total: 0,
    total_paginas: 1,
    total_consultas: "0",
    pagos_recibidos: "0",
    saldo_pendiente: "0"
  });

  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorLista, setErrorLista] = useState("");
  const [errorDetalle, setErrorDetalle] = useState("");
  const [errorPago, setErrorPago] = useState("");
  const [aviso, setAviso] = useState("");

  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [notas, setNotas] = useState("");

  useEffect(() => {
    let vigente = true;

    async function cargar() {
      setCargando(true);
      setErrorLista("");

      try {
        const parametros = new URLSearchParams({
          buscar: filtro,
          pagina: String(pagina)
        });

        const respuesta = await consultarApi(
          `/api/cobros?${parametros}`,
          { token: sesion.token }
        );

        if (vigente) {
          setDatos(respuesta);
        }
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorLista(error.message);
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
    filtro,
    pagina,
    revision,
    sesion.token,
    onSesionExpirada
  ]);

  useEffect(() => {
    if (!citaId) {
      return undefined;
    }

    let vigente = true;

    async function cargar() {
      setCargandoDetalle(true);
      setErrorDetalle("");
      setDetalle(null);

      try {
        const respuesta = await consultarApi(
          `/api/cobros/citas/${citaId}`,
          { token: sesion.token }
        );

        if (vigente) {
          setDetalle(respuesta);
          setMonto("");
        }
      } catch (error) {
        if (vigente) {
          if (error.status === 401) {
            onSesionExpirada();
          } else {
            setErrorDetalle(error.message);
          }
        }
      } finally {
        if (vigente) {
          setCargandoDetalle(false);
        }
      }
    }

    cargar();

    return () => {
      vigente = false;
    };
  }, [citaId, revision, sesion.token, onSesionExpirada]);

  function limpiarPendiente() {
    try {
      sessionStorage.removeItem(claveLocal);
    } catch {
      // El backend seguirá reconociendo la clave si se reintenta.
    }

    setPendiente(null);
  }

  async function enviarOperacion(operacion) {
    if (enviando) {
      return;
    }

    setEnviando(true);
    setErrorPago("");
    setAviso("");

    try {
      const respuesta = await consultarApi("/api/cobros/pagos", {
        method: "POST",
        token: sesion.token,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(operacion)
      });

      limpiarPendiente();
      setAviso(`${respuesta.mensaje} Número de pago: ${respuesta.pago_id}.`);
      setCitaId(operacion.cita_id);
      setMonto("");
      setReferencia("");
      setNotas("");
      setRevision((actual) => actual + 1);
    } catch (error) {
      if (error.status === 401) {
        onSesionExpirada();
      } else {
        setErrorPago(error.message);

        if ([400, 403, 404, 409].includes(error.status)) {
          limpiarPendiente();
          setRevision((actual) => actual + 1);
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  async function registrarPago(evento) {
    evento.preventDefault();

    if (enviando || pendiente || !detalle) {
      return;
    }

    const operacion = {
      clave_operacion: crypto.randomUUID(),
      cita_id: detalle.cuenta.id,
      monto,
      metodo_pago: metodo,
      referencia,
      notas
    };

    try {
      sessionStorage.setItem(
        claveLocal,
        JSON.stringify(operacion)
      );
    } catch {
      setErrorPago(
        "El navegador bloqueó el almacenamiento temporal. Habilítalo para registrar el pago con recuperación de envío."
      );
      return;
    }

    setPendiente(operacion);
    await enviarOperacion(operacion);
  }

  function buscar(evento) {
    evento.preventDefault();
    setFiltro(busqueda.trim());
    setPagina(1);
    setRevision((actual) => actual + 1);
  }

  function abrirCuenta(id) {
    setCitaId(id);
    setMonto("");
    setMetodo("efectivo");
    setReferencia("");
    setNotas("");
    setErrorPago("");
    setAviso("");
  }

  return (
    <section className="modulo-cobros">
      <header className="cabecera-modulo">
        <div>
          <h1>Cobros y facturación</h1>
          <p className="descripcion">
            Pagos y saldos de consultas completadas
          </p>
        </div>

        <button
          type="button"
          className="boton-secundario"
          onClick={() => setRevision((actual) => actual + 1)}
          disabled={enviando}
        >
          Actualizar
        </button>
      </header>

      <div className="resumen-cobros">
        <article className="tarjeta indicador-cobro">
          <span>Total de consultas</span>
          <strong>{dinero(datos.total_consultas)}</strong>
        </article>

        <article className="tarjeta indicador-cobro">
          <span>Pagos recibidos</span>
          <strong>{dinero(datos.pagos_recibidos)}</strong>
        </article>

        <article className="tarjeta indicador-cobro saldo">
          <span>Saldo pendiente</span>
          <strong>{dinero(datos.saldo_pendiente)}</strong>
        </article>
      </div>

      <p className="descripcion alcance-cobros">
        Totales generales de consultas completadas. La búsqueda filtra
        la tabla, no estos totales.
      </p>

      {aviso && (
        <p className="mensaje mensaje-aviso" role="status">
          {aviso}
        </p>
      )}

      {errorPago && (
        <p className="mensaje mensaje-error" role="alert">
          {errorPago}
        </p>
      )}

      {pendiente && (
        <div className="mensaje mensaje-aviso">
          <p>
            Hay un envío por comprobar para la cita {pendiente.cita_id},
            por {dinero(pendiente.monto)}.
          </p>
          <p>
            Reintenta la misma operación. Si ya se registró,
            el sistema no creará otro pago.
          </p>
          <button
            type="button"
            className="boton-secundario"
            disabled={enviando}
            onClick={() => enviarOperacion(pendiente)}
          >
            {enviando ? "Comprobando..." : "Comprobar o reintentar pago"}
          </button>
        </div>
      )}

      <form className="buscador-pacientes buscador-cobros" onSubmit={buscar}>
        <label className="solo-lectores" htmlFor="buscar-cobros">
          Buscar por paciente
        </label>
        <input
          id="buscar-cobros"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          maxLength={150}
          placeholder="Buscar por nombre del paciente..."
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

      <section className="tarjeta listado-pacientes">
        <div className="tabla-desplazable" aria-busy={cargando}>
          <table className="tabla-pacientes">
            <caption className="solo-lectores">
              Cuentas de consultas completadas
            </caption>
            <thead>
              <tr>
                <th scope="col">Paciente</th>
                <th scope="col">Concepto</th>
                <th scope="col">Importe</th>
                <th scope="col">Abonado</th>
                <th scope="col">Saldo</th>
                <th scope="col">Estado</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={7} className="estado-tabla">
                    Cargando cuentas...
                  </td>
                </tr>
              ) : datos.cuentas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="estado-tabla">
                    No hay consultas completadas con ese criterio.
                  </td>
                </tr>
              ) : (
                datos.cuentas.map((cuenta) => (
                  <tr key={cuenta.id}>
                    <td className="nombre-paciente">{cuenta.paciente}</td>
                    <td>{cuenta.motivo}</td>
                    <td>{dinero(cuenta.importe_total)}</td>
                    <td>{dinero(cuenta.total_pagado)}</td>
                    <td>{dinero(cuenta.saldo)}</td>
                    <td>
                      <span
                        className={`estado-cobro ${estadoCuenta(cuenta).toLowerCase()}`}
                      >
                        {estadoCuenta(cuenta)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="boton-secundario"
                        disabled={enviando}
                        onClick={() => abrirCuenta(cuenta.id)}
                      >
                        Ver / registrar pago
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="paginacion">
          <span>{datos.total} consultas</span>
          <div>
            <button
              type="button"
              className="boton-secundario"
              disabled={cargando || pagina === 1}
              onClick={() => setPagina((actual) => actual - 1)}
            >
              Anterior
            </button>
            <span>Página {pagina} de {datos.total_paginas}</span>
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

      {cargandoDetalle && (
        <p className="mensaje mensaje-aviso" role="status">
          Cargando pagos de la consulta...
        </p>
      )}

      {errorDetalle && (
        <p className="mensaje mensaje-error" role="alert">
          {errorDetalle}
        </p>
      )}

      {detalle && !cargandoDetalle && (
        <section className="tarjeta detalle-cobro">
          <header className="cabecera-modulo">
            <div>
              <h2>{detalle.cuenta.paciente}</h2>
              <p className="descripcion">
                Cita {detalle.cuenta.id} · {detalle.cuenta.motivo}
              </p>
              <p className="descripcion">
                {fechaHora(detalle.cuenta.fecha_hora)}
              </p>
            </div>
            <strong>Saldo: {dinero(detalle.cuenta.saldo)}</strong>
          </header>

          {Number(detalle.cuenta.saldo) > 0 ? (
            <form onSubmit={registrarPago} className="formulario-pago">
              <fieldset disabled={enviando || Boolean(pendiente)}>
                <legend>Registrar pago</legend>

                <div className="rejilla-formulario">
                  <div className="campo">
                    <label htmlFor="monto-pago">Monto a pagar ($) *</label>
                    <input
                      id="monto-pago"
                      type="number"
                      min="0.01"
                      max={detalle.cuenta.saldo}
                      step="0.01"
                      value={monto}
                      onChange={(evento) => setMonto(evento.target.value)}
                      required
                    />
                  </div>

                  <div className="campo">
                    <label htmlFor="metodo-pago">Método de pago *</label>
                    <select
                      id="metodo-pago"
                      value={metodo}
                      onChange={(evento) => setMetodo(evento.target.value)}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="tarjeta">Tarjeta</option>
                      <option value="transferencia">Transferencia</option>
                    </select>
                  </div>

                  <div className="campo ancho-completo">
                    <label htmlFor="referencia-pago">
                      Referencia del comprobante
                    </label>
                    <input
                      id="referencia-pago"
                      value={referencia}
                      onChange={(evento) => setReferencia(evento.target.value)}
                      maxLength={150}
                      placeholder="Referencia de transferencia o comprobante"
                    />
                  </div>

                  <div className="campo ancho-completo">
                    <label htmlFor="notas-pago">Notas</label>
                    <textarea
                      id="notas-pago"
                      value={notas}
                      onChange={(evento) => setNotas(evento.target.value)}
                      rows={3}
                      maxLength={2000}
                    />
                  </div>
                </div>

                <p className="descripcion">
                  Registra pagos ya recibidos. No ingreses números completos
                  de tarjeta ni códigos de seguridad.
                </p>

                <div className="acciones-formulario">
                  <button
                    type="submit"
                    className="boton-principal boton-ajustado"
                  >
                    {enviando ? "Registrando..." : "Registrar pago"}
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <p className="mensaje mensaje-aviso">
              Esta consulta no tiene saldo pendiente.
            </p>
          )}

          <h3 className="titulo-pagos">Pagos registrados</h3>

          {detalle.pagos.length === 0 ? (
            <p className="descripcion">Todavía no hay pagos registrados.</p>
          ) : (
            <div className="historia-pagos">
              {detalle.pagos.map((pago) => (
                <article key={pago.id} className="registro-pago">
                  <div>
                    <strong>{dinero(pago.monto)}</strong>
                    <span>{pago.metodo_pago} · {pago.estado}</span>
                  </div>
                  <p>{fechaHora(pago.fecha_pago)}</p>
                  <p>
                    Registrado por: {pago.recibido_por || "Sin registro"}
                  </p>
                  {pago.referencia && <p>Referencia: {pago.referencia}</p>}
                  {pago.notas && <p>{pago.notas}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}