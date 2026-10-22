import { useCallback, useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import Panel from "./Panel.jsx";

const CLAVE_CORREO = "control_medico_correo";

function leerCorreoGuardado() {
  try {
    return localStorage.getItem(CLAVE_CORREO) || "";
  } catch {
    return "";
  }
}

export default function App() {
  const [email, setEmail] = useState(leerCorreoGuardado);
  const [recordarCorreo, setRecordarCorreo] = useState(
    () => Boolean(leerCorreoGuardado())
  );
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [sesion, setSesion] = useState(null);

  const terminarSesion = useCallback((mensaje) => {
    setSesion(null);
    setPassword("");
    setMostrarPassword(false);
    setError("");
    setAviso(mensaje);
  }, []);

  const sesionExpirada = useCallback(() => {
    terminarSesion(
      "Tu sesión venció o dejó de ser válida. Inicia sesión nuevamente."
    );
  }, [terminarSesion]);

  useEffect(() => {
    if (!sesion) {
      return undefined;
    }

    const tiempoRestante = Math.max(
      sesion.expiraEn - Date.now(),
      0
    );

    const temporizador = setTimeout(
      sesionExpirada,
      tiempoRestante
    );

    return () => clearTimeout(temporizador);
  }, [sesion, sesionExpirada]);

  async function iniciarSesion(evento) {
    evento.preventDefault();

    if (cargando) {
      return;
    }

    setCargando(true);
    setError("");
    setAviso("");

    try {
      const acceso = await consultarApi("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim(),
          password
        })
      });

      if (
        typeof acceso.token !== "string" ||
        !Number.isFinite(acceso.expira_en_segundos) ||
        acceso.expira_en_segundos <= 0
      ) {
        throw new Error("El servidor no devolvió una sesión válida.");
      }

      const expiraEn =
        Date.now() + acceso.expira_en_segundos * 1000;

      const perfil = await consultarApi("/api/auth/me", {
        token: acceso.token
      });

      if (!perfil.usuario) {
        throw new Error("No se pudieron obtener los datos de la cuenta.");
      }

      try {
        if (recordarCorreo) {
          localStorage.setItem(
            CLAVE_CORREO,
            email.trim().toLowerCase()
          );
        } else {
          localStorage.removeItem(CLAVE_CORREO);
        }
      } catch {
        // El acceso funciona aunque el almacenamiento esté bloqueado.
      }

      setSesion({
        token: acceso.token,
        usuario: perfil.usuario,
        expiraEn
      });

      setPassword("");
      setMostrarPassword(false);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargando(false);
    }
  }

  if (sesion) {
    return (
      <Panel
        sesion={sesion}
        onCerrarSesion={() =>
          terminarSesion("Has cerrado sesión.")
        }
        onSesionExpirada={sesionExpirada}
      />
    );
  }

  return (
    <main className="pantalla-acceso">
      <div className="contenedor-acceso">
        <div className="marca marca-acceso">Clínica médica</div>

        <section
          className="tarjeta tarjeta-acceso"
          aria-labelledby="titulo-acceso"
        >
          <header className="encabezado-acceso">
            <h1 id="titulo-acceso">Bienvenido de nuevo</h1>
            <p className="descripcion">
              Ingresa tus credenciales para continuar.
            </p>
          </header>

          <form onSubmit={iniciarSesion} aria-busy={cargando}>
            <div className="campo">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="correo@ejemplo.com"
                autoComplete="username"
                maxLength={254}
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
                required
                disabled={cargando}
              />
            </div>

            <div className="campo">
              <label htmlFor="password">Contraseña</label>
              <div className="entrada-password">
                <input
                  id="password"
                  name="password"
                  type={mostrarPassword ? "text" : "password"}
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                  value={password}
                  onChange={(evento) =>
                    setPassword(evento.target.value)
                  }
                  required
                  disabled={cargando}
                />
                <button
                  type="button"
                  className="boton-mostrar"
                  onClick={() =>
                    setMostrarPassword(!mostrarPassword)
                  }
                  aria-controls="password"
                  aria-pressed={mostrarPassword}
                  aria-label={
                    mostrarPassword
                      ? "Ocultar contraseña"
                      : "Mostrar contraseña"
                  }
                  disabled={cargando}
                >
                  {mostrarPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            <div className="opciones-acceso">
              <label className="casilla">
                <input
                  type="checkbox"
                  checked={recordarCorreo}
                  onChange={(evento) =>
                    setRecordarCorreo(evento.target.checked)
                  }
                  disabled={cargando}
                />
                <span>Recordar correo</span>
              </label>
            </div>

            {error && (
              <p className="mensaje mensaje-error" role="alert">
                {error}
              </p>
            )}

            {aviso && (
              <p className="mensaje mensaje-aviso" role="status">
                {aviso}
              </p>
            )}

            <button
              type="submit"
              className="boton-principal"
              disabled={cargando}
            >
              {cargando ? "Ingresando..." : "Iniciar sesión"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}