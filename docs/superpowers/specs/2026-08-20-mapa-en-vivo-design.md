# Mapa en vivo: la ruta aparece y se dibuja tramo a tramo

**Fecha:** 2026-08-20
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Que el mapa abierto en el navegador muestre la ruta que el agente está calculando, sin
copiar ningún enlace: los marcadores aparecen al empezar, la línea crece tramo a tramo, y
al terminar queda la ruta definitiva con su altimetría y sus peajes.

## Punto de partida

Hoy `plan_route` devuelve un enlace autocontenido que hay que abrir a mano. La web y el
servidor MCP no se comunican: el único puente es que el usuario copie una URL. El enlace
seguirá existiendo, porque sirve para compartir una ruta o abrirla en el móvil.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Canal | SSE (`EventSource`), sin dependencias nuevas |
| Alcance | Una sola pizarra global; sin sesiones |
| Persistencia | Se retiene la última publicación |
| Conflicto con trabajo propio | Entra sola si el mapa está vacío; si no, aviso con botón |
| Ubicación del aviso | Arriba en la barra lateral |
| Alternativas de ruta | El MCP pide omitirlas: el modo en vivo es tres veces más rápido |
| Granularidad | El tramo; es la única que conoce el backend |
| Enlace compartible | Se mantiene, conviven ambos mecanismos |

## Arquitectura

```
MCP  ── POST /api/route { live, alternatives: false, labels } ──►  Backend
                                                                     │
                              rutea tramo a tramo y publica ─────────┤
                                                                     ▼
Navegador  ◄────────── GET /api/live  (SSE, EventSource) ──────  Pizarra
```

El MCP no conoce la pizarra: sigue llamando a `/api/route` y solo marca la petición como
«en vivo». El backend es el único emisor, porque es quien tiene el bucle que rutea cada
tramo. Esto mantiene al MCP como capa delgada.

## Componentes

| Fichero | Responsabilidad |
|---|---|
| `backend/src/services/live.ts` | La pizarra: suscriptores, difusión, última publicación |
| `backend/src/index.ts` | `GET /api/live` y los parámetros nuevos de `/api/route` |
| `backend/src/services/brouter.ts` | Aviso por tramo terminado y omisión de alternativas |
| `frontend/src/live.ts` | Cliente `EventSource` y reducción de eventos a estado |
| `frontend/src/App.tsx` | Suscripción, aplicación o retención, aviso |
| `frontend/src/components/MapView.tsx` | Capa de la línea en construcción |
| `frontend/src/components/Sidebar.tsx` | Tarjeta de aviso |
| `frontend/src/i18n.tsx` | Claves del aviso en los tres idiomas |
| `mcp/src/backend.ts`, `mcp/src/tools.ts` | Enviar `live`, `labels` y `alternatives` |
| `docker/frontend-nginx.conf` | `proxy_buffering off` para la ruta del flujo |

## Contrato de la pizarra

```ts
export type LiveEvent =
  | { type: "start"; waypoints: LiveWaypoint[]; roundTrip: boolean; segments: number }
  | { type: "leg"; index: number; coordinates: LngLat[]; distanceM: number; durationS: number }
  | { type: "done"; route: RouteResult }
  | { type: "error"; message: string };

publish(event: LiveEvent): void
subscribe(send: (event: LiveEvent) => void): () => void   // devuelve la baja
snapshot(): LiveEvent[]                                    // para quien llega tarde
```

`snapshot()` devuelve la secuencia de la última planificación, no un evento suelto: quien
se conecta a mitad recibe el `start` y los `leg` ya emitidos, y así dibuja lo mismo que ve
quien estaba desde el principio. La secuencia se vacía al recibir un `start` nuevo.

## Parámetros nuevos de `/api/route`

| Campo | Tipo | Efecto |
|---|---|---|
| `live` | `{ labels: string[] }` opcional | Publica el progreso; las etiquetas viajan en el `start` |
| `alternatives` | booleano, por defecto `true` | En `false` no calcula las dos variantes extra |

Las etiquetas vienen del MCP, que es quien geocodificó los nombres. El backend solo las
reemite: no las interpreta.

## Comportamiento en el navegador

Al montar, la aplicación se suscribe. La línea en construcción vive en una capa propia del
mapa, separada de la ruta definitiva, de modo que el progreso nunca contamina el estado
real de la ruta.

- **Mapa vacío:** el `start` entra directo, los `leg` dibujan, el `done` fija la ruta.
- **Mapa con waypoints** (puestos a mano o llegados por enlace): la publicación se retiene
  y aparece la tarjeta de aviso. Al pulsar, se aplica lo retenido; si se ignora, se
  descarta cuando llega una publicación nueva.
- **Reconexión:** `EventSource` reconecta por su cuenta y lo primero que recibe es la
  secuencia retenida, así que se pone al día sin intervención.

El aviso es la única pieza de interfaz nueva. Va arriba en la barra lateral, en el hueco
que dejó la tarjeta de donaciones, y sus textos salen de `i18n.tsx` en los tres idiomas.

## Errores

| Situación | Comportamiento |
|---|---|
| Falla un tramo a mitad | `error` con el motivo; la web limpia el progreso y muestra el aviso |
| El navegador no escucha | La secuencia queda retenida para la próxima conexión |
| Se cierra la conexión | El servidor da de baja al suscriptor; sin bajas se acumulan escrituras a sockets muertos |
| El proxy almacena en búfer | Es el riesgo principal; se verifica antes de escribir la lógica |

## Pruebas

Unitarias, sobre lógica pura:

- La pizarra: publicar sin suscriptores, retener la secuencia, difundir a varios
  suscriptores, vaciar al llegar un `start`, dar de baja correctamente.
- La reducción de eventos en el frontend: aplicar `start`, acumular `leg`, cerrar con
  `done`, y el caso de mapa no vacío, que debe retener en lugar de sobrescribir.

De extremo a extremo, contra el despliegue: pedir una ruta por MCP mientras un `curl`
escucha `/api/live`, y comprobar que los eventos **llegan escalonados y no de golpe al
final**. Ese es el único modo de verificar que el proxy no está almacenando en búfer.

## Riesgos

**El búfer de nginx es el riesgo real.** Por defecto acumula la respuesta del backend, así
que un flujo SSE no llega hasta que termina, y el efecto en vivo desaparece sin ningún
error visible. No se reproduce en desarrollo, donde Vite conecta directo al backend. La
primera tarea del plan debe verificar el canal de punta a punta contra el despliegue antes
de construir nada encima, igual que la verificación del SDK en el trabajo anterior.

**Fugas de suscriptores.** Cada conexión SSE es una respuesta HTTP abierta. Si no se da de
baja al cerrarse, el servidor sigue escribiendo a un socket muerto.

**Coherencia entre el progreso y el resultado.** La línea acumulada con los `leg` debe
coincidir con la geometría del `done`. El backend une los tramos descartando el punto
duplicado de cada unión; la capa de progreso debe hacer lo mismo o la línea tendrá
vértices repetidos.

## Fuera de alcance

- Sesiones o pizarras por usuario.
- Que la web envíe algo al agente: el canal es unidireccional a propósito.
- Progreso más fino que el tramo.
- Retirar el enlace autocontenido.
- Historial de rutas publicadas: se retiene solo la última.
