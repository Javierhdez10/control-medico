import { useEffect, useRef, useState } from "react";
import Dialogo from "./Dialogo.jsx";

export default function useConfirmacion() {
  const [opciones, setOpciones] = useState(null);
  const resolver = useRef(null);
  useEffect(() => () => { resolver.current?.(null); resolver.current = null; }, []);
  function solicitar(datos) {
    if (resolver.current) return Promise.resolve(null);
    return new Promise(resolve => { resolver.current = resolve; setOpciones(datos); });
  }
  function terminar(datos) {
    resolver.current?.(datos); resolver.current = null; setOpciones(null);
  }
  return [solicitar, opciones ? <Dialogo key={opciones.titulo} opciones={opciones} terminar={terminar} /> : null];
}
