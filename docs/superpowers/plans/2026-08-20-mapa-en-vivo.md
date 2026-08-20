# Mapa en vivo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el mapa abierto en el navegador muestre la ruta que el agente calcula, dibujándose tramo a tramo, sin copiar ningún enlace.

**Architecture:** El backend gana una pizarra en memoria que difunde eventos por SSE. El MCP marca su petición de ruta como «en vivo» y el backend publica el progreso mientras rutea cada tramo. El frontend escucha con `EventSource` y dibuja la línea en una capa propia hasta que llega el resultado final.

**Tech Stack:** SSE nativo (`EventSource` en el navegador, `reply.raw` en Fastify), sin dependencias nuevas. `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-mapa-en-vivo-design.md`

## Global Constraints

- **Sin dependencias nuevas.** SSE con `EventSource` del navegador y `reply.raw` de Fastify. Prohibido `@fastify/websocket`, `socket.io` o similares.
- Runner de tests: `tsx --test`. Prohibido vitest o jest.
- Comentarios y mensajes de commit en alemán.
- Textos de interfaz solo por claves de `frontend/src/i18n.tsx`, en los tres idiomas, `de` como referencia.
- Ningún módulo salvo `backend/src/config.ts` lee `process.env` en el backend.
- Una sola pizarra global; sin sesiones ni identificadores de cliente.
- Se retiene la secuencia de la última planificación; una nueva la reemplaza.
- Con el mapa vacío la ruta entra sola; con waypoints propios se retiene y se avisa.
- El aviso va arriba en la barra lateral.
- El MCP pide las rutas sin alternativas (`alternatives: false`), y sigue devolviendo el enlace compartible.
- La granularidad del progreso es el tramo.
- El canal es unidireccional: el navegador nunca envía nada por él.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `backend/src/services/liveBoard.ts` | La pizarra: suscriptores, difusión, secuencia retenida |
| `backend/test/liveBoard.test.ts` | Pruebas de la pizarra |
| `backend/src/types.ts` | Tipos de los eventos |
| `backend/src/index.ts` | `GET /api/live` y los parámetros nuevos de `/api/route` |
| `backend/src/services/brouter.ts` | Aviso por tramo y omisión de alternativas |
| `frontend/src/live.ts` | Reducción de eventos a estado, sin React |
| `frontend/test/live.test.ts` | Pruebas de la reducción |
| `frontend/src/App.tsx` | Suscripción, aplicación o retención |
| `frontend/src/components/MapView.tsx` | Capa de la línea en construcción |
| `frontend/src/components/Sidebar.tsx` | Tarjeta de aviso |
| `frontend/src/i18n.tsx` | Textos del aviso |
| `frontend/src/index.css` | Estilo del aviso |
| `mcp/src/backend.ts`, `mcp/src/tools.ts` | Enviar `live` y `alternatives` |
| `docker/frontend-nginx.conf` | `proxy_buffering off` para el flujo |

---

### Task 1: Canal SSE de punta a punta

Va primera porque aquí vive el riesgo: nginx almacena en búfer por defecto y eso rompe SSE
sin dar ningún error. Se verifica contra el despliegue real antes de construir nada encima.

**Files:**
- Create: `backend/src/services/liveBoard.ts`
- Create: `backend/test/liveBoard.test.ts`
- Modify: `backend/src/types.ts`
- Modify: `backend/src/index.ts`
- Modify: `docker/frontend-nginx.conf`

**Interfaces:**
- Produces: `LiveEvent` (unión discriminada por `type`), y `liveBoard` con
  `publish(event: LiveEvent): void`, `subscribe(send: (e: LiveEvent) => void): () => void`,
  `snapshot(): LiveEvent[]`, `subscriberCount(): number`.

- [ ] **Step 1: Escribir el test que falla**

`backend/test/liveBoard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveBoard } from "../src/services/liveBoard.js";
import type { LiveEvent } from "../src/types.js";

const start: LiveEvent = {
  type: "start",
  waypoints: [
    { lng: 1, lat: 2, label: "A" },
    { lng: 3, lat: 4, label: "B" },
  ],
  roundTrip: false,
  segments: 1,
};
const leg = (index: number): LiveEvent => ({
  type: "leg",
  index,
  coordinates: [[0, 0], [1, 1]],
  distanceM: 1000,
  durationS: 60,
});

test("verliert nichts, wenn niemand zuhört", () => {
  const board = createLiveBoard();
  board.publish(start);
  assert.equal(board.subscriberCount(), 0);
  assert.deepEqual(board.snapshot(), [start]);
});

test("schickt neue Ereignisse an alle Zuhörer", () => {
  const board = createLiveBoard();
  const a: LiveEvent[] = [];
  const b: LiveEvent[] = [];
  board.subscribe((e) => a.push(e));
  board.subscribe((e) => b.push(e));
  board.publish(start);
  board.publish(leg(0));
  assert.equal(a.length, 2);
  assert.deepEqual(b, a);
});

test("hält die Folge der letzten Planung fest", () => {
  const board = createLiveBoard();
  board.publish(start);
  board.publish(leg(0));
  board.publish(leg(1));
  assert.equal(board.snapshot().length, 3);
});

test("beginnt bei einem neuen start eine neue Folge", () => {
  const board = createLiveBoard();
  board.publish(start);
  board.publish(leg(0));
  board.publish({ ...start, segments: 2 });
  const snap = board.snapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].type, "start");
});

test("meldet Zuhörer ab und schickt ihnen nichts mehr", () => {
  const board = createLiveBoard();
  const seen: LiveEvent[] = [];
  const off = board.subscribe((e) => seen.push(e));
  board.publish(start);
  assert.equal(board.subscriberCount(), 1);
  off();
  assert.equal(board.subscriberCount(), 0);
  board.publish(leg(0));
  assert.equal(seen.length, 1);
});

test("ein Fehler in einem Zuhörer stoppt die anderen nicht", () => {
  const board = createLiveBoard();
  const seen: LiveEvent[] = [];
  board.subscribe(() => { throw new Error("kaputt"); });
  board.subscribe((e) => seen.push(e));
  board.publish(start);
  assert.equal(seen.length, 1);
});

test("begrenzt die Folge, damit der Speicher nicht wächst", () => {
  const board = createLiveBoard();
  board.publish(start);
  for (let i = 0; i < 500; i++) board.publish(leg(i));
  assert.ok(board.snapshot().length <= 201, `zu lang: ${board.snapshot().length}`);
  // Der start muss erhalten bleiben, sonst kann ein später Zuhörer nichts zeichnen.
  assert.equal(board.snapshot()[0].type, "start");
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace backend`
Expected: FALLA, no existe `../src/services/liveBoard.js`.

- [ ] **Step 3: Añadir los tipos de evento**

Al final de `backend/src/types.ts`:

```ts
/** Wegpunkt, wie er im start-Ereignis der Live-Übertragung steht. */
export interface LiveWaypoint {
  lng: number;
  lat: number;
  label: string;
}

/** Ereignisse der Live-Übertragung an die Weboberfläche. */
export type LiveEvent =
  | {
      type: "start";
      waypoints: LiveWaypoint[];
      roundTrip: boolean;
      segments: number;
    }
  | {
      type: "leg";
      index: number;
      coordinates: LngLat[];
      distanceM: number;
      durationS: number;
    }
  | { type: "done"; route: unknown }
  | { type: "error"; message: string };
```

`route` va como `unknown` a propósito: el resultado completo de BRouter ya tiene su tipo en
el servicio, y la pizarra no necesita conocerlo para transportarlo.

- [ ] **Step 4: Implementar la pizarra**

`backend/src/services/liveBoard.ts`:

```ts
// Verteilt den Fortschritt einer Routenberechnung an die Weboberfläche.
// Eine einzige, globale Tafel: es gibt genau einen Nutzer und keine Sitzungen.
import type { LiveEvent } from "../types.js";

/** Obergrenze der gemerkten Folge. Schützt vor unbegrenztem Wachstum. */
const MAX_SEQUENCE = 200;

export interface LiveBoard {
  publish(event: LiveEvent): void;
  /** Meldet einen Zuhörer an und gibt die Abmeldung zurück. */
  subscribe(send: (event: LiveEvent) => void): () => void;
  /** Die Folge der letzten Planung, für später hinzukommende Zuhörer. */
  snapshot(): LiveEvent[];
  subscriberCount(): number;
}

export function createLiveBoard(): LiveBoard {
  const listeners = new Set<(event: LiveEvent) => void>();
  let sequence: LiveEvent[] = [];

  return {
    publish(event) {
      // Ein neues start beginnt eine neue Planung: alte Folge verwerfen.
      if (event.type === "start") sequence = [event];
      else if (sequence.length < MAX_SEQUENCE) sequence.push(event);

      for (const send of listeners) {
        try {
          send(event);
        } catch {
          // Ein hängender Zuhörer darf die übrigen nicht blockieren.
        }
      }
    },

    subscribe(send) {
      listeners.add(send);
      return () => { listeners.delete(send); };
    },

    snapshot() {
      return sequence;
    },

    subscriberCount() {
      return listeners.size;
    },
  };
}

export const liveBoard = createLiveBoard();
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run: `npm run test --workspace backend`
Expected: los 7 tests nuevos en verde, más los 11 del almacén de rutas.

- [ ] **Step 6: Publicar el flujo SSE**

En `backend/src/index.ts`, añadir el import:

```ts
import { liveBoard } from "./services/liveBoard.js";
```

Y este endpoint antes del bloque de servido estático:

```ts
// --- Live-Übertragung der Routenberechnung ---------------------------------
app.get("/api/live", async (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Bittet Zwischenspeicher, nichts zu puffern; nginx braucht zusätzlich
    // proxy_buffering off (siehe docker/frontend-nginx.conf).
    "X-Accel-Buffering": "no",
  });

  const send = (event: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Wer später dazukommt, bekommt zuerst die Folge der letzten Planung.
  for (const event of liveBoard.snapshot()) send(event);

  const off = liveBoard.subscribe(send);
  // Alle 25 s ein Kommentar, damit Proxys die Verbindung nicht schließen.
  const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

  const cleanup = () => {
    clearInterval(keepAlive);
    off();
  };
  req.raw.on("close", cleanup);
  req.raw.on("error", cleanup);
});
```

- [ ] **Step 7: Desactivar el búfer en nginx**

En `docker/frontend-nginx.conf`, dentro del bloque `location /api/`, añadir:

```nginx
        # SSE: ohne das sammelt nginx die Antwort und die Live-Übertragung
        # erreicht den Browser erst am Ende – ohne jede Fehlermeldung.
        proxy_buffering off;
        proxy_cache off;
```

- [ ] **Step 8: Verificar el canal contra el despliegue real**

Este es el paso que justifica el orden del plan. Publicar, desplegar y comprobar que los
eventos llegan **escalonados**:

```bash
git add -A && git commit -m "feat: Live-Kanal per SSE" && git push origin HEAD
ssh server_ia 'cd /home/chispas/herramientas/motorrad-routenplaner
  git fetch origin -q && git reset --hard origin/main -q
  docker compose -f docker-compose.server.yml up -d --build \
    motorrad-routenplaner-backend motorrad-routenplaner-web'
```

Con el flujo abierto en una terminal:

```bash
ssh server_ia 'timeout 20 curl -sN http://192.168.65.9:9640/api/live | while read -r l; do echo "$(date +%T) $l"; done'
```

Y en otra, provocando eventos con un pequeño script en el contenedor del backend:

```bash
ssh server_ia 'docker exec motorrad-routenplaner-backend node -e "
  const http=require(\"node:http\");
  // Kein Endpunkt zum Auslösen: der Test kommt in Task 3 über /api/route.
  console.log(\"Platzhalter\");
"'
```

Expected en este paso: la petición a `/api/live` **no se cierra** y devuelve las cabeceras
`text/event-stream` de inmediato. Si `curl -sN` se queda esperando sin cerrar, el canal está
abierto. Si devuelve todo de golpe al cortar el tiempo, es que nginx sigue almacenando: en
ese caso revisar que `proxy_buffering off` esté en el bloque correcto y reconstruir la imagen
del frontend (el fichero de nginx viaja dentro de la imagen).

Comprobación de cabeceras, que es la señal inequívoca:

```bash
ssh server_ia 'curl -sI --max-time 10 http://192.168.65.9:9640/api/live | head -6'
```

Expected: `content-type: text/event-stream` y **sin** `content-length`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/liveBoard.ts backend/test/liveBoard.test.ts \
  backend/src/types.ts backend/src/index.ts docker/frontend-nginx.conf
git commit -m "feat: Live-Kanal per SSE mit gemerkter Folge"
```

---

### Task 2: Progreso por tramo en el routing

**Files:**
- Modify: `backend/src/services/brouter.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `route(points, profiles, nogos, options?)` con
  `options?: { onLeg?: (leg: { index: number; coordinates: LngLat[]; distanceM: number; durationS: number }) => void; alternatives?: boolean }`.
  `routeVariant` gana el mismo `onLeg` como quinto parámetro opcional.

- [ ] **Step 1: Añadir el aviso por tramo a `routeVariant`**

En `backend/src/services/brouter.ts`, cambiar la firma:

```ts
async function routeVariant(
  points: LngLat[],
  profiles: ProfileName[],
  nogos: NoGo[],
  alternativeIdx: number,
  onLeg?: (leg: LegProgress) => void,
): Promise<BRouterResult> {
```

Y añadir el tipo junto a los demás del fichero:

```ts
/** Ein fertig berechneter Abschnitt, für die Live-Übertragung. */
export interface LegProgress {
  index: number;
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
}
```

Dentro del bucle, justo después de `legs.push(...)`:

```ts
    // Der Aufrufer darf schon zeichnen, bevor die ganze Route fertig ist.
    // Die Koordinaten sind die des Abschnitts, ohne den doppelten Übergangspunkt.
    onLeg?.({
      index: i,
      coordinates: i === 0 ? r.coords : r.coords.slice(1),
      distanceM: r.distanceM,
      durationS: r.durationS,
    });
```

El recorte del primer punto en los tramos posteriores replica exactamente lo que hace la
unión de `merged`, para que la línea acumulada por el navegador no tenga vértices repetidos.

- [ ] **Step 2: Añadir las opciones a `route`**

```ts
export interface RouteOptions {
  onLeg?: (leg: LegProgress) => void;
  /** Alternativen kosten zwei Drittel der Zeit; im Live-Betrieb überflüssig. */
  alternatives?: boolean;
}

export async function route(
  points: LngLat[],
  profiles: ProfileName[],
  nogos: NoGo[] = [],
  options: RouteOptions = {},
): Promise<BRouterResult> {
  const main = await routeVariant(points, profiles, nogos, 0, options.onLeg);

  if (options.alternatives === false) return main;

  const kept: BRouterResult[] = [];
  for (const idx of [1, 2]) {
    if (kept.length >= 2) break;
    try {
      const alt = await routeVariant(points, profiles, nogos, idx);
      if (isDistinct(alt, [main, ...kept])) kept.push(alt);
    } catch {
      /* Alternative nicht verfügbar – ignorieren. */
    }
  }

  return kept.length ? { ...main, alternatives: kept } : main;
}
```

Las alternativas **no** reciben `onLeg`: solo el trazado principal se dibuja en vivo.

- [ ] **Step 3: Comprobar tipos**

Run: `npm run build --workspace backend`
Expected: sin errores. Las llamadas existentes a `route(points, profs, nogos)` siguen
compilando porque `options` tiene valor por defecto.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/brouter.ts
git commit -m "feat: Fortschritt je Abschnitt und abschaltbare Alternativen"
```

---

### Task 3: El endpoint de ruta publica el progreso

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `liveBoard` de la Task 1, `route` con opciones de la Task 2.
- Produces: `/api/route` acepta `live?: { labels: string[] }` y `alternatives?: boolean`.

- [ ] **Step 1: Ampliar el tipo de la petición**

En `backend/src/types.ts`, dentro de `RouteRequest`, añadir:

```ts
  /** Wenn gesetzt, wird der Fortschritt live übertragen. Labels kommen vom MCP. */
  live?: { labels: string[] };
  /** Alternativen berechnen? Standard true. */
  alternatives?: boolean;
```

- [ ] **Step 2: Publicar desde el endpoint**

En `backend/src/index.ts`, sustituir el cuerpo del manejador de `/api/route` por esta
versión, que conserva la validación existente y añade la publicación:

```ts
app.post<{ Body: RouteRequest }>("/api/route", async (req, reply) => {
  const { points, profile, profiles, nogos, live, alternatives } =
    req.body ?? ({} as RouteRequest);
  if (!Array.isArray(points) || points.length < 2) {
    return reply.code(400).send({ error: "Mindestens zwei Punkte nötig." });
  }
  const norm = (p: unknown): ProfileName =>
    p === "fast" ? "fast" : p === "autobahn" ? "autobahn" : "curvy";
  // Abschnittsprofile haben Vorrang; sonst einheitliches Profil auf alle Abschnitte.
  const profs: ProfileName[] =
    Array.isArray(profiles) && profiles.length
      ? profiles.map(norm)
      : new Array(points.length - 1).fill(norm(profile));

  if (live) {
    // Die Labels kennt nur der Aufrufer (der MCP-Server hat sie aufgelöst).
    liveBoard.publish({
      type: "start",
      waypoints: points.map((p, i) => ({
        lng: p[0],
        lat: p[1],
        label: live.labels[i] ?? "",
      })),
      roundTrip: false,
      segments: profs.length,
    });
  }

  try {
    const result = await brouterRoute(points, profs, nogos ?? [], {
      alternatives: alternatives !== false,
      onLeg: live
        ? (leg) => liveBoard.publish({ type: "leg", ...leg })
        : undefined,
    });
    if (live) liveBoard.publish({ type: "done", route: result });
    return result;
  } catch (err: any) {
    const message = String(err.message ?? err);
    if (live) liveBoard.publish({ type: "error", message });
    req.log.error(err);
    return reply.code(502).send({ error: message });
  }
});
```

`roundTrip` va a `false` porque el MCP ya envía el punto de cierre dentro de `points`: la
web recibe la lista completa y no tiene que reconstruir nada.

- [ ] **Step 3: Comprobar tipos**

Run: `npm run build --workspace backend`
Expected: sin errores.

- [ ] **Step 4: Verificar el flujo con eventos reales**

Arrancar el backend contra el BRouter del servidor:

```bash
BROUTER_URL=http://192.168.65.9:9640/brouter PORT=8099 \
  ROUTES_DB_PATH=/tmp/live-test.db npx tsx backend/src/index.ts
```

En una terminal, escuchar con marca de tiempo:

```bash
timeout 200 curl -sN http://127.0.0.1:8099/api/live \
  | while IFS= read -r l; do [ -n "$l" ] && echo "$(date +%T) ${l:0:110}"; done
```

En otra, pedir una ruta de tres puntos en vivo:

```bash
curl -s -X POST http://127.0.0.1:8099/api/route -H "Content-Type: application/json" \
  -d '{"points":[[-2.935,43.263],[-2.679,43.316],[-2.45,43.30]],
       "profiles":["curvy","curvy"],
       "alternatives":false,
       "live":{"labels":["Bilbao","Gernika","Durango"]}}' > /dev/null
```

Expected: en la primera terminal aparece un `start`, después **un `leg` por tramo con
segundos de diferencia entre ellos**, y al final un `done`. Que las marcas de tiempo sean
distintas es la prueba de que el progreso es real y no un volcado final.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts backend/src/types.ts
git commit -m "feat: /api/route überträgt den Fortschritt live"
```

---

### Task 4: Reducción de eventos en el frontend

**Files:**
- Create: `frontend/src/live.ts`
- Create: `frontend/test/live.test.ts`

**Interfaces:**
- Produces: `LiveEvent` (mismo contrato que el backend), `LiveState`,
  `emptyLiveState()`, `applyLiveEvent(state: LiveState, event: LiveEvent): LiveState`,
  `subscribeLive(onEvent: (e: LiveEvent) => void): () => void`.

- [ ] **Step 1: Escribir el test que falla**

`frontend/test/live.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLiveEvent, emptyLiveState } from "../src/live.js";
import type { LiveEvent } from "../src/live.js";

const start: LiveEvent = {
  type: "start",
  waypoints: [
    { lng: 1, lat: 2, label: "Bilbao" },
    { lng: 3, lat: 4, label: "Gernika" },
  ],
  roundTrip: false,
  segments: 1,
};

test("el estado vacío no tiene nada pendiente", () => {
  const s = emptyLiveState();
  assert.equal(s.active, false);
  assert.equal(s.line.length, 0);
  assert.equal(s.waypoints.length, 0);
  assert.equal(s.done, null);
});

test("un start activa el estado y guarda los waypoints", () => {
  const s = applyLiveEvent(emptyLiveState(), start);
  assert.equal(s.active, true);
  assert.equal(s.waypoints.length, 2);
  assert.equal(s.waypoints[0].label, "Bilbao");
  assert.equal(s.segments, 1);
});

test("acumula la línea con cada tramo", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, {
    type: "leg", index: 0, coordinates: [[0, 0], [1, 1]], distanceM: 10, durationS: 1,
  });
  s = applyLiveEvent(s, {
    type: "leg", index: 1, coordinates: [[2, 2]], distanceM: 5, durationS: 1,
  });
  assert.deepEqual(s.line, [[0, 0], [1, 1], [2, 2]]);
  assert.equal(s.legsDone, 2);
  assert.equal(s.distanceM, 15);
});

test("un done cierra la planificación y expone la ruta", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, { type: "done", route: { distanceM: 99 } });
  assert.equal(s.active, false);
  assert.deepEqual(s.done, { distanceM: 99 });
});

test("un start nuevo descarta el progreso anterior", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, {
    type: "leg", index: 0, coordinates: [[9, 9]], distanceM: 1, durationS: 1,
  });
  s = applyLiveEvent(s, { ...start, segments: 3 });
  assert.equal(s.line.length, 0);
  assert.equal(s.legsDone, 0);
  assert.equal(s.segments, 3);
});

test("un error desactiva y guarda el motivo", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, { type: "error", message: "kaputt" });
  assert.equal(s.active, false);
  assert.equal(s.error, "kaputt");
});

test("ignora tramos que llegan sin un start previo", () => {
  const s = applyLiveEvent(emptyLiveState(), {
    type: "leg", index: 0, coordinates: [[1, 1]], distanceM: 1, durationS: 1,
  });
  assert.equal(s.line.length, 0);
});

test("no muta el estado que recibe", () => {
  const a = applyLiveEvent(emptyLiveState(), start);
  const before = a.line.length;
  applyLiveEvent(a, {
    type: "leg", index: 0, coordinates: [[1, 1]], distanceM: 1, durationS: 1,
  });
  assert.equal(a.line.length, before);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace frontend`
Expected: FALLA, no existe `../src/live.js`.

- [ ] **Step 3: Implementar**

`frontend/src/live.ts`:

```ts
// Empfängt den Fortschritt einer Routenberechnung und führt ihn zu Zustand
// zusammen. Ohne React, damit die Logik testbar bleibt.
import type { LngLat, RouteResult } from "./types";

export interface LiveWaypoint {
  lng: number;
  lat: number;
  label: string;
}

export type LiveEvent =
  | { type: "start"; waypoints: LiveWaypoint[]; roundTrip: boolean; segments: number }
  | { type: "leg"; index: number; coordinates: LngLat[]; distanceM: number; durationS: number }
  | { type: "done"; route: unknown }
  | { type: "error"; message: string };

export interface LiveState {
  /** Läuft gerade eine Berechnung? */
  active: boolean;
  waypoints: LiveWaypoint[];
  roundTrip: boolean;
  segments: number;
  /** Bisher gezeichnete Linie. */
  line: LngLat[];
  legsDone: number;
  distanceM: number;
  durationS: number;
  /** Fertiges Ergebnis, sobald es vorliegt. */
  done: RouteResult | null;
  error: string | null;
}

export function emptyLiveState(): LiveState {
  return {
    active: false,
    waypoints: [],
    roundTrip: false,
    segments: 0,
    line: [],
    legsDone: 0,
    distanceM: 0,
    durationS: 0,
    done: null,
    error: null,
  };
}

export function applyLiveEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "start":
      // Eine neue Planung verwirft den Fortschritt der alten.
      return {
        ...emptyLiveState(),
        active: true,
        waypoints: event.waypoints,
        roundTrip: event.roundTrip,
        segments: event.segments,
      };

    case "leg":
      // Abschnitte ohne vorheriges start gehören zu einer Planung, die wir
      // nicht gesehen haben: nichts zeichnen.
      if (!state.active) return state;
      return {
        ...state,
        line: [...state.line, ...event.coordinates],
        legsDone: state.legsDone + 1,
        distanceM: state.distanceM + event.distanceM,
        durationS: state.durationS + event.durationS,
      };

    case "done":
      return { ...state, active: false, done: event.route as RouteResult };

    case "error":
      return { ...state, active: false, error: event.message };
  }
}

/** Hört den SSE-Kanal ab. Die Rückgabe beendet das Abhören. */
export function subscribeLive(onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource("/api/live");
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LiveEvent);
    } catch {
      // Unlesbares Ereignis überspringen, die Verbindung bleibt bestehen.
    }
  };
  // EventSource verbindet nach einem Fehler von selbst neu; nichts zu tun.
  return () => source.close();
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace frontend`
Expected: los 8 tests nuevos en verde, más los 15 que ya existían.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/live.ts frontend/test/live.test.ts
git commit -m "feat: Live-Ereignisse zu Zustand zusammenführen"
```

---

### Task 5: Dibujar el progreso y aplicar la ruta

**Files:**
- Modify: `frontend/src/components/MapView.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/i18n.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `subscribeLive`, `applyLiveEvent`, `emptyLiveState`, `LiveState` de la Task 4.
- Produces: prop `liveLine: LngLat[]` en `MapView`; props `liveActive`, `livePending`,
  `liveProgress`, `onApplyLive`, `onDismissLive` en `Sidebar`.

- [ ] **Step 1: Añadir la capa de progreso al mapa**

En `frontend/src/components/MapView.tsx`, añadir a `interface Props`:

```ts
  /** Linie der laufenden Live-Berechnung; leer, wenn keine läuft. */
  liveLine: LngLat[];
```

Dentro del `map.on("load", ...)`, **antes** de `map.addSource("alt-routes", ...)` para que
quede por debajo de las demás líneas:

```ts
      map.addSource("live-route", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "live-line",
        type: "line",
        source: "live-route",
        layout: { "line-join": "round", "line-cap": "round" },
        // Gestrichelt und heller: es ist eine Vorschau, nicht das Ergebnis.
        paint: {
          "line-color": "#4ea1ff",
          "line-width": 4,
          "line-opacity": 0.85,
          "line-dasharray": [2, 1.5],
        },
      });
```

Añadir la sincronización, junto a las otras funciones `sync*`:

```ts
  const syncLive = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("live-route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const line = cbRef.current.liveLine;
    if (line.length < 2) {
      src.setData(emptyFc());
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } },
      ],
    } as any);
  };
```

Llamar a `syncLive()` en el `map.on("load", ...)` junto a las otras sincronizaciones, y
añadir un efecto que reaccione al cambio:

```ts
  useEffect(syncLive, [props.liveLine]);
```

- [ ] **Step 2: Añadir los textos**

En `frontend/src/i18n.tsx`, en `de`, antes de `"wp.title"`:

```ts
  "live.calculating": "Der Assistent berechnet eine Route …",
  "live.progress": "Abschnitt {done} von {total}",
  "live.pendingTitle": "Neue Route vom Assistenten",
  "live.pendingBody": "Auf der Karte stehen eigene Wegpunkte. Übernehmen?",
  "live.apply": "Übernehmen",
  "live.dismiss": "Verwerfen",
```

En `en`:

```ts
  "live.calculating": "The assistant is calculating a route …",
  "live.progress": "Leg {done} of {total}",
  "live.pendingTitle": "New route from the assistant",
  "live.pendingBody": "The map has your own waypoints. Load it?",
  "live.apply": "Load",
  "live.dismiss": "Discard",
```

En `es`:

```ts
  "live.calculating": "El asistente está calculando una ruta …",
  "live.progress": "Tramo {done} de {total}",
  "live.pendingTitle": "Ruta nueva del asistente",
  "live.pendingBody": "El mapa tiene puntos tuyos. ¿La cargo?",
  "live.apply": "Cargar",
  "live.dismiss": "Descartar",
```

- [ ] **Step 3: Añadir el estilo del aviso**

En `frontend/src/index.css`, junto a los estilos de la barra lateral:

```css
/* Hinweis auf eine Route, die der Assistent gerade geschickt hat */
.live-card { border-color: #4ea1ff; }
.live-row { display: flex; gap: 6px; margin-top: 6px; }
.live-row button { flex: 1; }
```

- [ ] **Step 4: Añadir la tarjeta al Sidebar**

En `interface Props` de `frontend/src/components/Sidebar.tsx`:

```ts
  // Live-Übertragung
  liveActive: boolean;
  liveProgress: { done: number; total: number };
  livePending: boolean;
  onApplyLive: () => void;
  onDismissLive: () => void;
```

Como primer elemento dentro de `<aside className="sidebar">`:

```tsx
      {(p.liveActive || p.livePending) && (
        <div className="card live-card">
          {p.liveActive ? (
            <>
              <strong>{t("live.calculating")}</strong>
              <p className="muted">
                {t("live.progress", {
                  done: p.liveProgress.done,
                  total: p.liveProgress.total,
                })}
              </p>
            </>
          ) : (
            <>
              <strong>{t("live.pendingTitle")}</strong>
              <p className="muted">{t("live.pendingBody")}</p>
              <div className="live-row">
                <button className="primary" onClick={p.onApplyLive}>
                  {t("live.apply")}
                </button>
                <button className="ghost" onClick={p.onDismissLive}>
                  {t("live.dismiss")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 5: Conectar en App.tsx**

Añadir imports:

```ts
import { applyLiveEvent, emptyLiveState, subscribeLive, type LiveState } from "./live";
```

Estado y suscripción:

```ts
  // Live-Übertragung des Assistenten
  const [live, setLive] = useState<LiveState>(emptyLiveState);
  // Fertige Live-Route, die auf Bestätigung wartet (Karte war nicht leer).
  const [livePending, setLivePending] = useState<LiveState | null>(null);
  // Ohne Ref würde der Effekt bei jeder Änderung der Wegpunkte neu abonnieren.
  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;

  useEffect(() => {
    return subscribeLive((event) => {
      setLive((prev) => {
        const next = applyLiveEvent(prev, event);
        // Ist die Karte leer, übernimmt die Live-Route direkt; sonst wartet sie.
        if (event.type === "done") {
          if (waypointsRef.current.length === 0) applyLiveState(next);
          else setLivePending(next);
        }
        return next;
      });
    });
  }, []);

  /** Wegpunkte und Rundtour aus einer Live-Planung übernehmen. */
  const applyLiveState = (state: LiveState) => {
    setWaypoints(
      state.waypoints.map((w) => ({
        id: newId(),
        lng: w.lng,
        lat: w.lat,
        label: w.label || `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`,
        profile: defaultProfile,
      })),
    );
    setRoundTrip(state.roundTrip);
    setLoadedRouteId(null);
    setLivePending(null);
  };
```

`applyLiveState` debe declararse **antes** del `useEffect` que la usa, porque el efecto la
captura al montar.

Pasar a `MapView`:

```tsx
          liveLine={live.active ? live.line : []}
```

Y a `Sidebar`:

```tsx
        liveActive={live.active}
        liveProgress={{ done: live.legsDone, total: live.segments }}
        livePending={livePending !== null}
        onApplyLive={() => livePending && applyLiveState(livePending)}
        onDismissLive={() => setLivePending(null)}
```

- [ ] **Step 6: Comprobar tipos**

Run: `npm run build --workspace frontend`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MapView.tsx frontend/src/components/Sidebar.tsx \
  frontend/src/i18n.tsx frontend/src/index.css frontend/src/App.tsx
git commit -m "feat: Live-Route zeichnen und übernehmen"
```

---

### Task 6: El MCP pide en vivo

**Files:**
- Modify: `mcp/src/backend.ts`
- Modify: `mcp/src/tools.ts`
- Modify: `mcp/src/types.ts`

**Interfaces:**
- Consumes: los parámetros nuevos de `/api/route` de la Task 3.
- Produces: `route(points, profiles, nogos, opts?)` en el cliente del MCP, con
  `opts?: { live?: { labels: string[] }; alternatives?: boolean }`.

- [ ] **Step 1: Ampliar el cliente del MCP**

En `mcp/src/backend.ts`, cambiar la firma de `route` en la interfaz `BackendClient`:

```ts
  route(
    points: LngLat[],
    profiles: ProfileName[],
    nogos: NoGo[],
    opts?: { live?: { labels: string[] }; alternatives?: boolean },
  ): Promise<RouteResult>;
```

Y la implementación:

```ts
    route: (points, profiles, nogos, opts) =>
      post<RouteResult>("/api/route", {
        points,
        profiles,
        nogos,
        ...(opts?.live ? { live: opts.live } : {}),
        ...(opts?.alternatives === false ? { alternatives: false } : {}),
      }),
```

- [ ] **Step 2: Usarlo en `planRoute`**

En `mcp/src/tools.ts`, sustituir la llamada:

```ts
        const route = await api.route(routingPoints, profiles, nogos);
```

por:

```ts
        // Live an die Weboberfläche übertragen und die Alternativen weglassen:
        // sie kosten zwei Drittel der Zeit und ändern das Gezeichnete nicht.
        const route = await api.route(routingPoints, profiles, nogos, {
          live: { labels: resolved.map((r) => r.label) },
          alternatives: false,
        });
```

Nótese que `routingPoints` ya incluye el punto de cierre en las rutas circulares, y
`resolved` no: por eso las etiquetas se rellenan con cadena vacía en el backend para el
punto que sobra, que es exactamente el comportamiento buscado.

- [ ] **Step 3: Ajustar el fake de los tests**

En `mcp/test/tools.test.ts`, las dos funciones que construyen clientes falsos declaran
`route` con tres parámetros. TypeScript acepta implementaciones con menos parámetros que la
interfaz, así que **no hace falta cambiarlas**. Ejecutar los tests confirma esto.

Run: `npm run test --workspace mcp`
Expected: los 40 tests siguen en verde.

- [ ] **Step 4: Comprobar tipos**

Run: `npm run build --workspace mcp`
Expected: sin errores, contrato de tipos incluido.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/backend.ts mcp/src/tools.ts
git commit -m "feat: MCP überträgt live und ohne Alternativen"
```

---

### Task 7: Despliegue y verificación de extremo a extremo

**Files:**
- Modify: `CLAUDE.md`
- Modify: `config/config.yaml`

- [ ] **Step 1: Publicar y desplegar los tres servicios**

```bash
npm test
git switch dev-2026-08-20 && git merge --no-ff feat/live-map -m "merge: feat/live-map"
git switch main && git merge --ff-only dev-2026-08-20 && git push origin main
ssh server_ia 'cd /home/chispas/herramientas/motorrad-routenplaner
  git fetch origin -q && git reset --hard origin/main -q
  docker compose -f docker-compose.server.yml up -d --build
  sleep 40
  docker compose -f docker-compose.server.yml ps'
```

Expected: los cuatro contenedores `healthy`.

- [ ] **Step 2: Comprobar que el flujo llega sin búfer**

```bash
ssh server_ia 'curl -sI --max-time 10 http://192.168.65.9:9640/api/live | head -8'
```

Expected: `content-type: text/event-stream`, y **sin** `content-length`.

- [ ] **Step 3: La prueba real, con marcas de tiempo**

Escuchar y pedir una ruta por MCP a la vez:

```bash
ssh server_ia '
(timeout 260 curl -sN http://192.168.65.9:9640/api/live \
  | while IFS= read -r l; do [ -n "$l" ] && echo "$(date +%T) ${l:0:100}"; done) &
sleep 2
curl -s --max-time 250 -X POST http://192.168.65.9:9641/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"plan_route\",\"arguments\":{\"points\":[\"Bilbao\",\"Gernika\",\"Durango\"],\"profile\":\"curvy\"}}}" \
  > /dev/null
wait'
```

Expected: un `start`, luego **dos `leg` con marcas de tiempo separadas por segundos**, y un
`done`. Si los tres llegan con la misma marca, nginx está almacenando y hay que revisar
`proxy_buffering off`.

- [ ] **Step 4: Comprobar en el navegador**

Abrir `http://192.168.65.9:9640/` con el mapa vacío y pedir una ruta al agente por MCP.
Expected: aparece la tarjeta «El asistente está calculando una ruta …» con el contador de
tramos, la línea azul discontinua crece tramo a tramo, y al terminar los waypoints entran en
la barra lateral y la ruta definitiva se dibuja en naranja.

Repetir con waypoints propios ya puestos en el mapa.
Expected: no se sobrescribe nada; aparece el aviso con «Cargar» y «Descartar».

- [ ] **Step 5: Documentar**

En `CLAUDE.md`, añadir una sección sobre el canal en vivo: que `liveBoard.ts` es una pizarra
global en memoria, que el progreso nace en el bucle de tramos de `brouter.ts` porque es el
único sitio que conoce los tramos, que el MCP pide sin alternativas para no esperar el
triple, y que **nginx necesita `proxy_buffering off`** o el flujo no llega hasta el final sin
dar ningún error.

En `config/config.yaml`, añadir el bloque:

```yaml
live_map:
  endpoint: /api/live
  transport: sse
  scope: pizarra global, sin sesiones
  retained: solo la ultima planificacion
  notes:
    - nginx necesita proxy_buffering off en /api/, o el flujo llega de golpe al final.
    - El MCP pide alternatives:false: son dos tercios del tiempo y no cambian lo dibujado.
    - El canal es unidireccional; la web nunca envia nada por el.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md config/config.yaml
git commit -m "docs: Live-Übertragung dokumentiert"
```

---

## Self-review

**Cobertura de la spec.** Canal SSE y pizarra con secuencia retenida, Task 1. Los cuatro
eventos, Tasks 1 y 3. Progreso por tramo con la misma unión de geometría que el resultado
final, Task 2. Omisión de alternativas, Tasks 2 y 6. Capa propia para la línea en
construcción, Task 5. Entrada directa con mapa vacío y aviso con mapa ocupado, Task 5.
Reconexión, cubierta por `EventSource` y la secuencia retenida de la Task 1. Baja de
suscriptores, Task 1 Step 6. `proxy_buffering off`, Task 1 Step 7 y verificado en Tasks 1 y 7.
Pruebas unitarias, Tasks 1 y 4; de extremo a extremo con marcas de tiempo, Task 7.

**Sin placeholders.** El Step 8 de la Task 1 contiene un fragmento con la palabra
«Platzhalter»: es deliberado y está explicado en su comentario, porque el disparador real de
eventos no existe hasta la Task 3; lo que esa tarea verifica es que el canal se abre y las
cabeceras son correctas, no que lleguen eventos.

**Consistencia de nombres.** `createLiveBoard`, `liveBoard`, `publish`, `subscribe`,
`snapshot`, `subscriberCount`, `LiveEvent`, `LiveWaypoint`, `LegProgress`, `RouteOptions`,
`applyLiveEvent`, `emptyLiveState`, `subscribeLive`, `LiveState`, `liveLine`, `liveActive`,
`liveProgress`, `livePending`, `onApplyLive`, `onDismissLive` se usan igual en todas las
tareas. El tipo `LiveEvent` se declara dos veces a propósito, en `backend/src/types.ts` y en
`frontend/src/live.ts`: no hay importación entre workspaces, y la Task 7 Step 3 comprueba la
equivalencia real sobre el cable.

**Riesgo con vigilancia.** El búfer de nginx es el único fallo que no produce ningún error
visible; por eso se verifica dos veces, con las cabeceras en la Task 1 y con marcas de
tiempo en la Task 7.
