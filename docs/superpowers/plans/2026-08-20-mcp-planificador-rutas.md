# Servidor MCP de planificación de rutas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un servidor MCP HTTP que permita a un agente planificar rutas de moto con el backend existente y devolver un enlace que abra esa ruta en la web.

**Architecture:** Nuevo workspace `mcp/` en el monorepo. El servidor MCP es una capa delgada: valida argumentos, llama a `/api/*` del backend por HTTP interno, da forma al resultado para un agente y construye un enlace autocontenido. Sin estado entre llamadas. El frontend gana la capacidad de leer una ruta desde la URL.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.30.0, `zod` 4, `node:http` de la biblioteca estándar, `tsx --test` como runner, Docker.

**Spec:** `docs/superpowers/specs/2026-08-20-mcp-planificador-rutas-design.md`

## Global Constraints

- Node >= 22 (el SDK exige >= 18; los contenedores usan `node:22-slim`).
- `@modelcontextprotocol/sdk` exactamente `^1.30.0`. No usar `@modelcontextprotocol/server` (paquete 2.x, en alfa).
- `zod` `^4.2.0`, requerido como peer por el SDK.
- Runner de tests: `tsx --test`. Prohibido añadir vitest, jest o similar.
- Comentarios y mensajes de commit en alemán, como el resto del repositorio.
- Textos de interfaz del frontend solo por claves de `i18n.tsx`; el diccionario `de` es la referencia.
- Ninguna constante de configuración escrita a mano en la lógica: todo pasa por `mcp/src/config.ts`.
- Ningún módulo salvo `config.ts` lee `process.env`.
- Puerto interno del MCP: `8081`. Publicado en la LAN: `9641`. Ruta: `/mcp`.
- Perfiles válidos, con los mismos identificadores que la API: `fast`, `curvy`, `autobahn`.
- Límite de waypoints por ruta: 10.

## Nota sobre los tipos compartidos

La spec pide reutilizar `backend/src/types.ts` para que un cambio incompatible rompa el
build del MCP. Importar entre workspaces choca con `rootDir` al emitir JavaScript, así que
se implementa de otra forma con el mismo efecto: el MCP declara sus tipos en
`mcp/src/types.ts` y un fichero de contrato, comprobado con `tsc --noEmit`, verifica que
son asignables en ambos sentidos contra los del backend. Si el backend cambia de forma
incompatible, el contrato falla al compilar.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `mcp/package.json` | Workspace, scripts, dependencias |
| `mcp/tsconfig.json` | Build que emite `dist/` |
| `mcp/tsconfig.contract.json` | Comprobación de tipos contra el backend, sin emitir |
| `mcp/contract/types-contract.ts` | Asignabilidad de tipos MCP ↔ backend |
| `mcp/src/types.ts` | Tipos del dominio usados por el MCP |
| `mcp/src/config.ts` | Configuración por entorno, validada al arrancar |
| `mcp/src/deeplink.ts` | Construcción del enlace a la web |
| `mcp/src/validate.ts` | Validación de argumentos de las herramientas |
| `mcp/src/backend.ts` | Cliente HTTP de `/api/*` y traducción de errores |
| `mcp/src/format.ts` | Resumen legible para el agente |
| `mcp/src/tools.ts` | Registro de `plan_route` y `geocode_place` |
| `mcp/src/index.ts` | Servidor HTTP y transporte MCP |
| `mcp/test/*.test.ts` | Pruebas unitarias |
| `frontend/src/deeplink.ts` | Parseo del enlace, sin dependencias de React |
| `frontend/test/deeplink.test.ts` | Pruebas del parseo |
| `frontend/src/App.tsx` | Poblar waypoints desde la URL al montar |
| `Dockerfile.mcp` | Imagen del servidor MCP |
| `docker-compose.server.yml` | Cuarto servicio |

---

### Task 1: Esqueleto del workspace y verificación del SDK

Esta tarea va primero para eliminar el mayor riesgo técnico: confirmar la firma real de la
API del SDK antes de escribir lógica de dominio.

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts`
- Modify: `package.json` (raíz: añadir workspace `mcp`, `tsx` en devDependencies, script `test`)

**Interfaces:**
- Consumes: nada.
- Produces: un servidor MCP escuchando en `config.port` bajo la ruta `/mcp`, con una
  herramienta `ping` provisional que se elimina en la Task 8.

- [ ] **Step 1: Crear el workspace**

`mcp/package.json`:

```json
{
  "name": "mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "tsx --test test/*.test.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^4.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

`mcp/tsconfig.json` (copia el estilo de `backend/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

En el `package.json` de la raíz: añadir `"mcp"` al array `workspaces`, añadir
`"tsx": "^4.19.2"` a `devDependencies`, y estos scripts:

```json
"dev:mcp": "npm run dev --workspace mcp",
"test": "npm run test --workspace mcp"
```

En `build` de la raíz, añadir el workspace `mcp` al final de la cadena.

Nota: el script `test` solo cubre `mcp` porque el frontend no tiene pruebas hasta la
Task 9, que lo amplía. Igualmente, `build` de `mcp` solo compila `tsconfig.json`; la
Task 2 le añade la comprobación del contrato cuando ese fichero exista.

- [ ] **Step 2: Servidor mínimo con una herramienta provisional**

`mcp/src/index.ts`:

```ts
// MCP-Server (Streamable HTTP). Vorläufig nur mit einem ping-Werkzeug, um die
// SDK-Anbindung zu verifizieren; die echten Werkzeuge kommen in tools.ts.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.MCP_PORT ?? 8081);
const HOST = process.env.MCP_HOST ?? "127.0.0.1";

const mcp = new McpServer({ name: "motorrad-routenplaner", version: "0.1.0" });

mcp.registerTool(
  "ping",
  {
    description: "Antwortet mit pong. Nur zur Überprüfung der Verbindung.",
    inputSchema: { echo: z.string().optional() },
  },
  async ({ echo }) => ({
    content: [{ type: "text", text: echo ? `pong: ${echo}` : "pong" }],
  }),
);

// Zustandslos: keine Session-IDs, jede Anfrage ist unabhängig.
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await mcp.connect(transport);

const http = createServer((req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    transport.handleRequest(req, res, body).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
});

http.listen(PORT, HOST, () => {
  console.log(`MCP-Server auf http://${HOST}:${PORT}/mcp`);
});
```

- [ ] **Step 3: Instalar y verificar que la API del SDK es la esperada**

```bash
npm install
npm run dev:mcp
```

En otra terminal:

```bash
curl -s -X POST http://127.0.0.1:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Esperado: respuesta con `result.serverInfo.name === "motorrad-routenplaner"`.

**Este paso es el punto de control del riesgo.** Si `registerTool`, `inputSchema` o
`transport.handleRequest(req, res, body)` no tienen esa firma en 1.30.0, ajustar aquí
consultando `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` y
`streamableHttp.d.ts`, y **anotar la firma real en este plan** antes de seguir. No
continuar a la Task 2 sin un `initialize` correcto.

- [ ] **Step 4: Verificar el listado de herramientas**

```bash
curl -s -X POST http://127.0.0.1:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Esperado: la lista contiene `ping` con su `inputSchema` en JSON Schema.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json mcp/
git commit -m "feat: Grundgerüst für den MCP-Server"
```

---

### Task 2: Tipos y contrato con el backend

**Files:**
- Create: `mcp/src/types.ts`
- Create: `mcp/contract/types-contract.ts`
- Create: `mcp/tsconfig.contract.json`

**Interfaces:**
- Produces: `LngLat`, `ProfileName`, `NoGo`, `RouteLeg`, `RouteFeaturePoint`,
  `RouteResult`, `GeocodeResult`, `Poi`, `Roadwork`, `WeatherPoint`, `WeatherResult`.

- [ ] **Step 1: Declarar los tipos**

`mcp/src/types.ts`:

```ts
// Domänentypen des MCP-Servers. Die Gegenprüfung zu backend/src/types.ts
// erfolgt über contract/types-contract.ts.
export type LngLat = [number, number];
export type ProfileName = "fast" | "curvy" | "autobahn";

export interface NoGo { lng: number; lat: number; radius: number }
export interface RouteLeg { distanceM: number; durationS: number }

export interface RouteFeaturePoint {
  lng: number;
  lat: number;
  kind: "toll" | "ferry";
  lengthM: number;
  atM: number;
  label?: string;
}

export interface RouteResult {
  geojson: unknown;
  distanceM: number;
  durationS: number;
  legs?: RouteLeg[];
  features?: RouteFeaturePoint[];
}

export interface GeocodeResult { label: string; lat: number; lng: number }

export interface Poi {
  id: string;
  lat: number;
  lng: number;
  name: string;
  kind: string;
  category: "food" | "fuel";
  cuisine?: string;
  brand?: string;
  distance: number;
  quality?: number;
  verified: boolean;
}

export interface Roadwork {
  id: string;
  lat: number;
  lng: number;
  title: string;
  description?: string;
  source: "autobahn" | "osm";
  radius: number;
}

export interface WeatherPoint {
  lng: number;
  lat: number;
  atM: number;
  weatherCode: number;
  tempMax: number | null;
  tempMin: number | null;
  precipMm: number | null;
  windMaxKmh: number | null;
}

export interface WeatherResult { date: string; points: WeatherPoint[] }
```

- [ ] **Step 2: Escribir el contrato**

`mcp/contract/types-contract.ts`:

```ts
// Prüft, dass die MCP-Typen mit denen des Backends kompatibel bleiben.
// Wird nur typgeprüft (tsconfig.contract.json, noEmit) und nie ausgeführt:
// eine inkompatible Änderung im Backend bricht damit den Build.
import type * as B from "../../backend/src/types.js";
import type * as M from "./../src/types.js";

// Zuweisbarkeit in beide Richtungen erzwingen.
const _lngLat: B.LngLat = [0, 0] as M.LngLat;
const _lngLatBack: M.LngLat = [0, 0] as B.LngLat;
const _profile: B.ProfileName = "curvy" as M.ProfileName;
const _profileBack: M.ProfileName = "curvy" as B.ProfileName;
const _nogo: B.NoGo = {} as M.NoGo;
const _nogoBack: M.NoGo = {} as B.NoGo;
const _leg: B.RouteLeg = {} as M.RouteLeg;
const _legBack: M.RouteLeg = {} as B.RouteLeg;
const _feat: B.RouteFeaturePoint = {} as M.RouteFeaturePoint;
const _featBack: M.RouteFeaturePoint = {} as B.RouteFeaturePoint;
const _geo: B.GeocodeResult = {} as M.GeocodeResult;
const _geoBack: M.GeocodeResult = {} as B.GeocodeResult;
const _poi: B.Poi = {} as M.Poi;
const _poiBack: M.Poi = {} as B.Poi;
const _rw: B.Roadwork = {} as M.Roadwork;
const _rwBack: M.Roadwork = {} as B.Roadwork;
const _wp: B.WeatherPoint = {} as M.WeatherPoint;
const _wpBack: M.WeatherPoint = {} as B.WeatherPoint;

// Verhindert "unused"-Fehler, ohne zur Laufzeit etwas zu tun.
export type ContractChecked = typeof _lngLat | typeof _lngLatBack | typeof _profile
  | typeof _profileBack | typeof _nogo | typeof _nogoBack | typeof _leg
  | typeof _legBack | typeof _feat | typeof _featBack | typeof _geo
  | typeof _geoBack | typeof _poi | typeof _poiBack | typeof _rw
  | typeof _rwBack | typeof _wp | typeof _wpBack;
```

Ampliar el script `build` de `mcp/package.json`, que hasta ahora solo compilaba:

```json
"build": "tsc -p tsconfig.json && tsc -p tsconfig.contract.json",
```

`mcp/tsconfig.contract.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "noUnusedLocals": false
  },
  "include": ["src", "contract"]
}
```

- [ ] **Step 3: Verificar que el contrato pasa**

Run: `npm run build --workspace mcp`
Expected: sin errores.

- [ ] **Step 4: Verificar que el contrato detecta divergencias**

Cambiar temporalmente en `mcp/src/types.ts` el tipo `ProfileName` a `"fast" | "curvy"`.

Run: `npm run build --workspace mcp`
Expected: FALLA en `contract/types-contract.ts` porque `B.ProfileName` no es asignable.
Deshacer el cambio y volver a ejecutar: pasa.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/types.ts mcp/contract/ mcp/tsconfig.contract.json
git commit -m "feat: MCP-Typen mit Vertragsprüfung gegen das Backend"
```

---

### Task 3: Configuración validada

**Files:**
- Create: `mcp/src/config.ts`
- Create: `mcp/test/config.test.ts`
- Modify: `mcp/src/index.ts` (usar `config` en lugar de leer `process.env`)

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` y la constante `config`.
  `Config` tiene `port`, `host`, `backendUrl`, `publicWebUrl`, `routeTimeoutMs`, `maxPoints`.

- [ ] **Step 1: Escribir el test que falla**

`mcp/test/config.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("nimmt Defaults, wenn nichts gesetzt ist", () => {
  const c = loadConfig({});
  assert.equal(c.port, 8081);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.backendUrl, "http://127.0.0.1:8080");
  assert.equal(c.publicWebUrl, "http://127.0.0.1:9640");
  assert.equal(c.routeTimeoutMs, 180000);
  assert.equal(c.maxPoints, 10);
});

test("entfernt abschließende Schrägstriche der URLs", () => {
  const c = loadConfig({ BACKEND_URL: "http://b:8080/", PUBLIC_WEB_URL: "http://w:9640///" });
  assert.equal(c.backendUrl, "http://b:8080");
  assert.equal(c.publicWebUrl, "http://w:9640");
});

test("lehnt einen ungültigen Port ab", () => {
  assert.throws(() => loadConfig({ MCP_PORT: "0" }), /MCP_PORT/);
  assert.throws(() => loadConfig({ MCP_PORT: "abc" }), /MCP_PORT/);
});

test("lehnt eine ungültige Backend-URL ab", () => {
  assert.throws(() => loadConfig({ BACKEND_URL: "kein-url" }), /BACKEND_URL/);
});

test("lehnt ein ungültiges Zeitlimit ab", () => {
  assert.throws(() => loadConfig({ ROUTE_TIMEOUT_MS: "-5" }), /ROUTE_TIMEOUT_MS/);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/config.js`.

- [ ] **Step 3: Implementar**

`mcp/src/config.ts`:

```ts
// Zentrale Konfiguration. Kein anderes Modul liest process.env.
// Ungültige Werte brechen den Start ab, statt später bei der ersten Anfrage.
export interface Config {
  port: number;
  host: string;
  backendUrl: string;
  publicWebUrl: string;
  routeTimeoutMs: number;
  /** Obergrenze für Wegpunkte je Route (Laufzeit: (N-1)*3 BRouter-Aufrufe). */
  maxPoints: number;
}

function intInRange(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} ist ungültig: "${raw}" (erwartet ganze Zahl ${min}–${max})`);
  }
  return n;
}

function httpUrl(raw: string | undefined, fallback: string, name: string): string {
  const value = raw === undefined || raw === "" ? fallback : raw;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} ist ungültig: "${value}" (erwartet eine URL)`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} ist ungültig: "${value}" (erwartet http oder https)`);
  }
  return value.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: intInRange(env.MCP_PORT, 8081, 1, 65535, "MCP_PORT"),
    host: env.MCP_HOST && env.MCP_HOST !== "" ? env.MCP_HOST : "127.0.0.1",
    backendUrl: httpUrl(env.BACKEND_URL, "http://127.0.0.1:8080", "BACKEND_URL"),
    publicWebUrl: httpUrl(env.PUBLIC_WEB_URL, "http://127.0.0.1:9640", "PUBLIC_WEB_URL"),
    routeTimeoutMs: intInRange(env.ROUTE_TIMEOUT_MS, 180000, 1000, 600000, "ROUTE_TIMEOUT_MS"),
    maxPoints: intInRange(env.MCP_MAX_POINTS, 10, 2, 25, "MCP_MAX_POINTS"),
  };
}

export const config = loadConfig(process.env);
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: 5 tests en verde.

- [ ] **Step 5: Usar la configuración en index.ts**

En `mcp/src/index.ts`, sustituir las constantes `PORT`/`HOST` por `import { config } from "./config.js";` y usar `config.port` y `config.host`.

Run: `npm run build --workspace mcp`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/config.ts mcp/src/index.ts mcp/test/config.test.ts
git commit -m "feat: validierte Konfiguration für den MCP-Server"
```

---

### Task 4: Construcción del enlace a la web

**Files:**
- Create: `mcp/src/deeplink.ts`
- Create: `mcp/test/deeplink.test.ts`

**Interfaces:**
- Consumes: `ProfileName` de `mcp/src/types.ts`.
- Produces: `interface DeepLinkWaypoint { lng: number; lat: number; profile: ProfileName; name?: string }`
  y `buildDeepLink(baseUrl: string, waypoints: DeepLinkWaypoint[], roundTrip: boolean): string`.

- [ ] **Step 1: Escribir el test que falla**

`mcp/test/deeplink.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepLink } from "../src/deeplink.js";

const BASE = "http://192.168.65.9:9640";

test("baut einen Link mit zwei Wegpunkten", () => {
  const url = buildDeepLink(BASE, [
    { lng: -2.935, lat: 43.263, profile: "curvy", name: "Bilbao" },
    { lng: -0.549, lat: 42.571, profile: "fast", name: "Jaca" },
  ], false);
  assert.equal(
    url,
    "http://192.168.65.9:9640/?wp=-2.935,43.263,curvy,Bilbao;-0.549,42.571,fast,Jaca",
  );
});

test("lässt den Namen weg, wenn keiner angegeben ist", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], false);
  assert.equal(url, "http://192.168.65.9:9640/?wp=1,2,curvy;3,4,curvy");
});

test("kodiert Namen mit Sonderzeichen", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy", name: "Donostia, Gipuzkoa" },
    { lng: 3, lat: 4, profile: "curvy", name: "Sant Julià" },
  ], false);
  assert.ok(url.includes("Donostia%2C%20Gipuzkoa"), url);
  assert.ok(url.includes("Sant%20Juli%C3%A0"), url);
  // Die Trennzeichen dürfen nicht aus einem Namen stammen können.
  assert.equal(url.split(";").length, 2);
});

test("markiert eine Rundtour", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], true);
  assert.ok(url.endsWith("&rt=1"), url);
});

test("rundet Koordinaten auf sechs Dezimalstellen", () => {
  const url = buildDeepLink(BASE, [
    { lng: -2.9350039123456, lat: 43.2630018987654, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], false);
  assert.ok(url.includes("-2.935004,43.263002"), url);
});

test("verlangt mindestens zwei Wegpunkte", () => {
  assert.throws(() => buildDeepLink(BASE, [{ lng: 1, lat: 2, profile: "curvy" }], false));
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/deeplink.js`.

- [ ] **Step 3: Implementar**

`mcp/src/deeplink.ts`:

```ts
// Baut den Link, mit dem die Weboberfläche eine Route direkt öffnet.
// Format: ?wp=lng,lat,profil,name;lng,lat,profil,name[&rt=1]
import type { ProfileName } from "./types.js";

export interface DeepLinkWaypoint {
  lng: number;
  lat: number;
  profile: ProfileName;
  name?: string;
}

/** Sechs Dezimalstellen entsprechen etwa 11 cm – genauer muss der Link nicht sein. */
function coord(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function buildDeepLink(
  baseUrl: string,
  waypoints: DeepLinkWaypoint[],
  roundTrip: boolean,
): string {
  if (waypoints.length < 2) {
    throw new Error("Für einen Link sind mindestens zwei Wegpunkte nötig.");
  }
  const tokens = waypoints.map((w) => {
    const base = `${coord(w.lng)},${coord(w.lat)},${w.profile}`;
    // encodeURIComponent maskiert auch , und ; – die Trennzeichen bleiben eindeutig.
    return w.name ? `${base},${encodeURIComponent(w.name)}` : base;
  });
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/?wp=${tokens.join(";")}${roundTrip ? "&rt=1" : ""}`;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: todos en verde.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/deeplink.ts mcp/test/deeplink.test.ts
git commit -m "feat: Link-Erzeugung für die Weboberfläche"
```

---

### Task 5: Validación de argumentos

**Files:**
- Create: `mcp/src/validate.ts`
- Create: `mcp/test/validate.test.ts`

**Interfaces:**
- Produces: `class ToolInputError extends Error`, `type Extra = "pois" | "fuel" | "weather"`,
  `interface PlanRouteInput { points: string[]; profile: ProfileName; profiles?: ProfileName[]; roundTrip: boolean; avoidRoadworks: boolean; include: Extra[] }`,
  `validatePlanRoute(raw: unknown, maxPoints: number): PlanRouteInput`,
  `segmentCount(pointCount: number, roundTrip: boolean): number`.

- [ ] **Step 1: Escribir el test que falla**

`mcp/test/validate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlanRoute, segmentCount, ToolInputError } from "../src/validate.js";

test("zählt Abschnitte mit und ohne Rundtour", () => {
  assert.equal(segmentCount(2, false), 1);
  assert.equal(segmentCount(3, false), 2);
  assert.equal(segmentCount(3, true), 3);
});

test("setzt Standardwerte", () => {
  const v = validatePlanRoute({ points: ["Bilbao", "Jaca"] }, 10);
  assert.equal(v.profile, "curvy");
  assert.equal(v.roundTrip, false);
  assert.equal(v.avoidRoadworks, true);
  assert.deepEqual(v.include, []);
});

test("verlangt mindestens zwei Punkte", () => {
  assert.throws(() => validatePlanRoute({ points: ["Bilbao"] }, 10), ToolInputError);
});

test("nennt die Obergrenze im Fehlertext", () => {
  const points = Array.from({ length: 11 }, (_, i) => `Ort ${i}`);
  assert.throws(() => validatePlanRoute({ points }, 10), /10/);
});

test("lehnt ein unbekanntes Profil ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["a", "b"], profile: "sport" }, 10), /sport/);
});

test("prüft die Länge von profiles gegen die Abschnitte", () => {
  assert.throws(
    () => validatePlanRoute({ points: ["a", "b", "c"], profiles: ["curvy"] }, 10),
    /2/,
  );
  const ok = validatePlanRoute({ points: ["a", "b", "c"], profiles: ["curvy", "fast"] }, 10);
  assert.deepEqual(ok.profiles, ["curvy", "fast"]);
});

test("berücksichtigt die Rundtour bei der Länge von profiles", () => {
  const ok = validatePlanRoute(
    { points: ["a", "b"], roundTrip: true, profiles: ["curvy", "fast"] },
    10,
  );
  assert.deepEqual(ok.profiles, ["curvy", "fast"]);
});

test("lehnt einen unbekannten Extra-Wert ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["a", "b"], include: ["hotels"] }, 10), /hotels/);
});

test("lehnt leere Ortsangaben ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["Bilbao", "  "] }, 10), ToolInputError);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/validate.js`.

- [ ] **Step 3: Implementar**

`mcp/src/validate.ts`:

```ts
// Prüft die Werkzeug-Argumente und liefert Meldungen, mit denen ein Agent
// seinen Aufruf korrigieren kann.
import type { ProfileName } from "./types.js";

export class ToolInputError extends Error {}

export type Extra = "pois" | "fuel" | "weather";

const PROFILES: ProfileName[] = ["fast", "curvy", "autobahn"];
const EXTRAS: Extra[] = ["pois", "fuel", "weather"];

export interface PlanRouteInput {
  points: string[];
  profile: ProfileName;
  profiles?: ProfileName[];
  roundTrip: boolean;
  avoidRoadworks: boolean;
  include: Extra[];
}

/** Bei einer Rundtour kommt der Rückweg zum Start als eigener Abschnitt hinzu. */
export function segmentCount(pointCount: number, roundTrip: boolean): number {
  return roundTrip ? pointCount : pointCount - 1;
}

function asProfile(value: unknown, field: string): ProfileName {
  if (typeof value !== "string" || !PROFILES.includes(value as ProfileName)) {
    throw new ToolInputError(
      `${field} ist ungültig: ${JSON.stringify(value)}. Erlaubt: ${PROFILES.join(", ")}.`,
    );
  }
  return value as ProfileName;
}

export function validatePlanRoute(raw: unknown, maxPoints: number): PlanRouteInput {
  const input = (raw ?? {}) as Record<string, unknown>;

  if (!Array.isArray(input.points)) {
    throw new ToolInputError("points fehlt: erwartet eine Liste aus Orten oder \"lng,lat\".");
  }
  if (input.points.length < 2) {
    throw new ToolInputError("points braucht mindestens zwei Einträge (Start und Ziel).");
  }
  if (input.points.length > maxPoints) {
    throw new ToolInputError(
      `points hat ${input.points.length} Einträge, erlaubt sind höchstens ${maxPoints}. ` +
        "Jeder Abschnitt kostet mehrere Routing-Aufrufe, darum die Grenze.",
    );
  }
  const points = input.points.map((p, i) => {
    if (typeof p !== "string" || p.trim() === "") {
      throw new ToolInputError(`points[${i}] ist leer oder kein Text.`);
    }
    return p.trim();
  });

  const roundTrip = input.roundTrip === true;
  const avoidRoadworks = input.avoidRoadworks !== false;
  const profile = input.profile === undefined ? "curvy" : asProfile(input.profile, "profile");

  let profiles: ProfileName[] | undefined;
  if (input.profiles !== undefined) {
    if (!Array.isArray(input.profiles)) {
      throw new ToolInputError("profiles muss eine Liste von Profilnamen sein.");
    }
    const expected = segmentCount(points.length, roundTrip);
    if (input.profiles.length !== expected) {
      throw new ToolInputError(
        `profiles hat ${input.profiles.length} Einträge, erwartet werden ${expected} ` +
          `(ein Profil je Abschnitt${roundTrip ? ", Rückweg eingeschlossen" : ""}).`,
      );
    }
    profiles = input.profiles.map((p, i) => asProfile(p, `profiles[${i}]`));
  }

  let include: Extra[] = [];
  if (input.include !== undefined) {
    if (!Array.isArray(input.include)) {
      throw new ToolInputError("include muss eine Liste sein.");
    }
    include = input.include.map((e) => {
      if (typeof e !== "string" || !EXTRAS.includes(e as Extra)) {
        throw new ToolInputError(
          `include enthält ${JSON.stringify(e)}. Erlaubt: ${EXTRAS.join(", ")}.`,
        );
      }
      return e as Extra;
    });
  }

  return { points, profile, profiles, roundTrip, avoidRoadworks, include };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: todos en verde.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/validate.ts mcp/test/validate.test.ts
git commit -m "feat: Prüfung der Werkzeug-Argumente"
```

---

### Task 6: Cliente del backend

**Files:**
- Create: `mcp/src/backend.ts`
- Create: `mcp/test/backend.test.ts`

**Interfaces:**
- Consumes: `config`, tipos de `types.ts`.
- Produces: `class BackendError extends Error` con `kind: "coverage" | "timeout" | "unavailable" | "upstream"`,
  y las funciones `geocode(q)`, `route(points, profiles, nogos)`, `roadworks(points, includeOsm)`,
  `pois(line, category, bufferM)`, `weather(line, date, samples)`.

- [ ] **Step 1: Escribir el test que falla**

El test levanta un backend falso con `node:http`, sin dependencias añadidas.

`mcp/test/backend.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createBackendClient, BackendError } from "../src/backend.js";

/** Startet einen Fake-Backend und liefert seine Basis-URL. */
async function withFakeBackend(
  handler: (url: string, body: unknown) => { status: number; json: unknown },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  let server: Server | undefined;
  try {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const out = handler(req.url ?? "", raw ? JSON.parse(raw) : undefined);
        res.writeHead(out.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

test("liest Geocoding-Ergebnisse", async () => {
  await withFakeBackend(
    () => ({ status: 200, json: [{ label: "Bilbao", lat: 43.263, lng: -2.935 }] }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      const res = await api.geocode("Bilbao");
      assert.equal(res[0].label, "Bilbao");
    },
  );
});

test("erkennt fehlende Kacheln als Abdeckungsproblem", async () => {
  await withFakeBackend(
    () => ({ status: 502, json: { error: "BRouter Routing fehlgeschlagen (500): position not mapped in existing datafile" } }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      await assert.rejects(
        () => api.route([[0, 0], [1, 1]], ["curvy"], []),
        (err: unknown) => err instanceof BackendError && err.kind === "coverage",
      );
    },
  );
});

test("meldet andere Backend-Fehler als upstream", async () => {
  await withFakeBackend(
    () => ({ status: 502, json: { error: "Overpass 504: gateway timeout" } }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      await assert.rejects(
        () => api.pois([[0, 0], [1, 1]], "food", 500),
        (err: unknown) => err instanceof BackendError && err.kind === "upstream",
      );
    },
  );
});

test("meldet einen nicht erreichbaren Backend als unavailable", async () => {
  // Port 1 ist reserviert und nimmt keine Verbindungen an.
  const api = createBackendClient("http://127.0.0.1:1", 2000);
  await assert.rejects(
    () => api.geocode("Bilbao"),
    (err: unknown) => err instanceof BackendError && err.kind === "unavailable",
  );
});

test("bricht bei Zeitüberschreitung ab", async () => {
  let server: Server | undefined;
  try {
    server = createServer(() => { /* antwortet absichtlich nie */ });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const api = createBackendClient(`http://127.0.0.1:${port}`, 300);
    await assert.rejects(
      () => api.geocode("Bilbao"),
      (err: unknown) => err instanceof BackendError && err.kind === "timeout",
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/backend.js`.

- [ ] **Step 3: Implementar**

`mcp/src/backend.ts`:

```ts
// Dünner Client für die Backend-API. Übersetzt Fehler in Kategorien, damit die
// Werkzeuge dem Agenten sagen können, was zu tun ist.
import { config } from "./config.js";
import type {
  GeocodeResult, LngLat, NoGo, Poi, ProfileName, Roadwork, RouteResult, WeatherResult,
} from "./types.js";

export type BackendErrorKind = "coverage" | "timeout" | "unavailable" | "upstream";

export class BackendError extends Error {
  constructor(readonly kind: BackendErrorKind, message: string) {
    super(message);
  }
}

/** BRouter meldet fehlende Kacheln so, wenn ein Punkt außerhalb der Daten liegt. */
function isCoverageProblem(message: string): boolean {
  return /not mapped in existing datafile|position not mapped|datafile/i.test(message);
}

export interface BackendClient {
  geocode(q: string): Promise<GeocodeResult[]>;
  route(points: LngLat[], profiles: ProfileName[], nogos: NoGo[]): Promise<RouteResult>;
  roadworks(points: LngLat[], includeOsm: boolean): Promise<Roadwork[]>;
  pois(line: LngLat[], category: "food" | "fuel", bufferM: number): Promise<Poi[]>;
  weather(line: LngLat[], date: string | undefined, samples: number): Promise<WeatherResult>;
}

export function createBackendClient(baseUrl: string, timeoutMs: number): BackendClient {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new BackendError(
          "timeout",
          `Das Backend hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} s geantwortet.`,
        );
      }
      throw new BackendError("unavailable", `Das Backend ist nicht erreichbar: ${String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch { /* Klartext-Antwort, so verwenden */ }
      if (isCoverageProblem(message)) {
        throw new BackendError(
          "coverage",
          "Mindestens ein Punkt liegt außerhalb der geladenen Routing-Kacheln. " +
            "Vorhanden sind die Iberische Halbinsel und der Süden Frankreichs.",
        );
      }
      throw new BackendError("upstream", message);
    }
    return JSON.parse(text) as T;
  }

  const post = <T>(path: string, body: unknown): Promise<T> =>
    call<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    geocode: (q) => call<GeocodeResult[]>(`/api/geocode?q=${encodeURIComponent(q)}`),
    route: (points, profiles, nogos) => post<RouteResult>("/api/route", { points, profiles, nogos }),
    roadworks: (points, includeOsm) => post<Roadwork[]>("/api/roadworks", { points, includeOsm }),
    pois: (line, category, bufferM) => post<Poi[]>("/api/pois", { line, category, bufferM }),
    weather: (line, date, samples) => post<WeatherResult>("/api/weather", { line, date, samples }),
  };
}

export const backend = createBackendClient(config.backendUrl, config.routeTimeoutMs);
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: todos en verde.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/backend.ts mcp/test/backend.test.ts
git commit -m "feat: Backend-Client mit übersetzten Fehlern"
```

---

### Task 7: Formateo del resultado para el agente

**Files:**
- Create: `mcp/src/format.ts`
- Create: `mcp/test/format.test.ts`

**Interfaces:**
- Produces: `formatDuration(seconds: number): string`, `formatDistance(meters: number): string`,
  `formatRouteSummary(input: RouteSummaryInput): string` con
  `interface RouteSummaryInput { labels: string[]; roundTrip: boolean; profiles: ProfileName[]; route: RouteResult; webUrl: string }`.

- [ ] **Step 1: Escribir el test que falla**

`mcp/test/format.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDistance, formatDuration, formatRouteSummary } from "../src/format.js";

test("formatiert Distanzen", () => {
  assert.equal(formatDistance(147746), "147,7 km");
  assert.equal(formatDistance(950), "950 m");
});

test("formatiert Fahrzeiten", () => {
  assert.equal(formatDuration(11820), "3 h 17 min");
  assert.equal(formatDuration(600), "10 min");
});

test("fasst eine Route mit Abschnitten zusammen", () => {
  const text = formatRouteSummary({
    labels: ["Bilbao", "Jaca"],
    roundTrip: false,
    profiles: ["curvy"],
    route: {
      geojson: null,
      distanceM: 147746,
      durationS: 11820,
      legs: [{ distanceM: 147746, durationS: 11820 }],
      features: [],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(text.includes("147,7 km"), text);
  assert.ok(text.includes("3 h 17 min"), text);
  assert.ok(text.includes("Bilbao"), text);
  assert.ok(text.includes("http://web/?wp=x"), text);
});

test("nennt Maut und Fähren, wenn vorhanden", () => {
  const text = formatRouteSummary({
    labels: ["A", "B"],
    roundTrip: false,
    profiles: ["fast"],
    route: {
      geojson: null,
      distanceM: 1000,
      durationS: 600,
      legs: [{ distanceM: 1000, durationS: 600 }],
      features: [
        { lng: 0, lat: 0, kind: "toll", lengthM: 4200, atM: 500, label: "Maut" },
        { lng: 1, lat: 1, kind: "ferry", lengthM: 800, atM: 900, label: "Fähre" },
      ],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(/Maut/.test(text), text);
  assert.ok(/Fähre/.test(text), text);
});

test("markiert den Rückweg einer Rundtour", () => {
  const text = formatRouteSummary({
    labels: ["A", "B"],
    roundTrip: true,
    profiles: ["curvy", "curvy"],
    route: {
      geojson: null,
      distanceM: 2000,
      durationS: 1200,
      legs: [{ distanceM: 1000, durationS: 600 }, { distanceM: 1000, durationS: 600 }],
      features: [],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(text.includes("A"), text);
  // Der letzte Abschnitt führt zurück zum Start.
  assert.ok(/zurück|Rundtour/i.test(text), text);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/format.js`.

- [ ] **Step 3: Implementar**

`mcp/src/format.ts`:

```ts
// Formt das Routing-Ergebnis in einen kurzen Text, den ein Agent direkt
// weitergeben kann. Absichtlich ohne Geometrie: die gehört in den Link.
import type { ProfileName, RouteResult } from "./types.js";

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return h > 0 ? `${h} h ${min} min` : `${min} min`;
}

export interface RouteSummaryInput {
  labels: string[];
  roundTrip: boolean;
  profiles: ProfileName[];
  route: RouteResult;
  webUrl: string;
}

export function formatRouteSummary(input: RouteSummaryInput): string {
  const { labels, roundTrip, profiles, route, webUrl } = input;
  const lines: string[] = [];

  lines.push(
    `Route: ${labels.join(" → ")}${roundTrip ? " → " + labels[0] + " (Rundtour)" : ""}`,
  );
  lines.push(
    `Gesamt: ${formatDistance(route.distanceM)}, ${formatDuration(route.durationS)}`,
  );

  const legs = route.legs ?? [];
  if (legs.length > 1) {
    lines.push("Abschnitte:");
    legs.forEach((leg, i) => {
      const from = labels[i] ?? `Punkt ${i + 1}`;
      const isReturn = roundTrip && i === legs.length - 1;
      const to = isReturn ? `${labels[0]} (zurück)` : (labels[i + 1] ?? `Punkt ${i + 2}`);
      const profile = profiles[i] ?? profiles[0];
      lines.push(
        `  ${i + 1}. ${from} → ${to} [${profile}]: ` +
          `${formatDistance(leg.distanceM)}, ${formatDuration(leg.durationS)}`,
      );
    });
  }

  const features = route.features ?? [];
  const tolls = features.filter((f) => f.kind === "toll");
  const ferries = features.filter((f) => f.kind === "ferry");
  if (tolls.length > 0) {
    lines.push(`Maut: ${tolls.length} Abschnitt(e), zusammen ${formatDistance(
      tolls.reduce((sum, f) => sum + f.lengthM, 0),
    )}`);
  }
  if (ferries.length > 0) {
    lines.push(`Fähre: ${ferries.length} Abschnitt(e), zusammen ${formatDistance(
      ferries.reduce((sum, f) => sum + f.lengthM, 0),
    )}`);
  }

  lines.push(`Auf der Karte öffnen: ${webUrl}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: todos en verde.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/format.ts mcp/test/format.test.ts
git commit -m "feat: lesbare Zusammenfassung der Route"
```

---

### Task 8: Las dos herramientas

**Files:**
- Create: `mcp/src/tools.ts`
- Create: `mcp/test/tools.test.ts`
- Modify: `mcp/src/index.ts` (registrar las herramientas reales y borrar `ping`)

**Interfaces:**
- Consumes: `BackendClient`, `validatePlanRoute`, `buildDeepLink`, `formatRouteSummary`, `config`.
- Produces: `resolvePoints(api, points): Promise<{ coord: LngLat; label: string }[]>` y
  `registerTools(mcp: McpServer, api: BackendClient, publicWebUrl: string, maxPoints: number): void`.

- [ ] **Step 1: Escribir el test que falla**

Se prueba `resolvePoints`, que es la lógica con reglas propias: acepta `"lng,lat"` tal cual
y resuelve nombres por geocoding tomando el primer candidato.

`mcp/test/tools.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePoints } from "../src/tools.js";
import { ToolInputError } from "../src/validate.js";
import type { BackendClient } from "../src/backend.js";

function fakeApi(geocodeResults: Record<string, { label: string; lat: number; lng: number }[]>): BackendClient {
  return {
    geocode: async (q) => geocodeResults[q] ?? [],
    route: async () => { throw new Error("nicht benutzt"); },
    roadworks: async () => [],
    pois: async () => [],
    weather: async () => ({ date: "", points: [] }),
  };
}

test("übernimmt Koordinaten unverändert", async () => {
  const out = await resolvePoints(fakeApi({}), ["-2.935,43.263", "1.5,42.0"]);
  assert.deepEqual(out[0].coord, [-2.935, 43.263]);
  assert.equal(out[0].label, "-2.935,43.263");
  assert.deepEqual(out[1].coord, [1.5, 42]);
});

test("löst Ortsnamen über Geocoding auf", async () => {
  const api = fakeApi({ Bilbao: [{ label: "Bilbao, Bizkaia", lat: 43.263, lng: -2.935 }] });
  const out = await resolvePoints(api, ["Bilbao"]);
  assert.deepEqual(out[0].coord, [-2.935, 43.263]);
  assert.equal(out[0].label, "Bilbao, Bizkaia");
});

test("nennt den Ort, der nicht gefunden wurde", async () => {
  const api = fakeApi({});
  await assert.rejects(
    () => resolvePoints(api, ["Kein Ort XYZ"]),
    (err: unknown) => err instanceof ToolInputError && /Kein Ort XYZ/.test((err as Error).message),
  );
});

test("lehnt Koordinaten außerhalb des gültigen Bereichs ab", async () => {
  await assert.rejects(
    () => resolvePoints(fakeApi({}), ["200,100"]),
    (err: unknown) => err instanceof ToolInputError,
  );
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace mcp`
Expected: FALLA, no existe `../src/tools.js`.

- [ ] **Step 3: Implementar**

`mcp/src/tools.ts`:

```ts
// Registriert die beiden Werkzeuge des Servers.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendClient } from "./backend.js";
import { BackendError } from "./backend.js";
import { buildDeepLink, type DeepLinkWaypoint } from "./deeplink.js";
import { formatRouteSummary, formatDistance } from "./format.js";
import { segmentCount, ToolInputError, validatePlanRoute } from "./validate.js";
import type { LngLat, NoGo, ProfileName } from "./types.js";

export interface ResolvedPoint {
  coord: LngLat;
  label: string;
}

/** "lng,lat" wird direkt übernommen, alles andere über Nominatim aufgelöst. */
export async function resolvePoints(
  api: BackendClient,
  points: string[],
): Promise<ResolvedPoint[]> {
  const out: ResolvedPoint[] = [];
  for (const point of points) {
    const asCoord = point.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (asCoord) {
      const lng = Number(asCoord[1]);
      const lat = Number(asCoord[2]);
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new ToolInputError(
          `"${point}" liegt außerhalb des gültigen Bereichs (erwartet "lng,lat").`,
        );
      }
      out.push({ coord: [lng, lat], label: point.trim() });
      continue;
    }
    const hits = await api.geocode(point);
    if (hits.length === 0) {
      throw new ToolInputError(
        `Für "${point}" wurde kein Ort gefunden. Mit geocode_place nach Alternativen suchen.`,
      );
    }
    out.push({ coord: [hits[0].lng, hits[0].lat], label: hits[0].label });
  }
  return out;
}

function toolError(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message =
    err instanceof ToolInputError || err instanceof BackendError
      ? err.message
      : `Unerwarteter Fehler: ${String(err)}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerTools(
  mcp: McpServer,
  api: BackendClient,
  publicWebUrl: string,
  maxPoints: number,
): void {
  mcp.registerTool(
    "geocode_place",
    {
      description:
        "Sucht Koordinaten zu einem Ort oder einer Adresse. Nützlich, um vor plan_route " +
        "mehrdeutige Namen zu klären.",
      inputSchema: { query: z.string().min(1).describe("Ort oder Adresse") },
    },
    async ({ query }) => {
      try {
        const hits = (await api.geocode(query)).slice(0, 5);
        if (hits.length === 0) {
          return { content: [{ type: "text", text: `Kein Treffer für "${query}".` }] };
        }
        const text = hits
          .map((h) => `${h.label} → ${h.lng},${h.lat}`)
          .join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  mcp.registerTool(
    "plan_route",
    {
      description:
        "Berechnet eine Motorradroute und liefert Zusammenfassung plus Link, der die Route " +
        "in der Weboberfläche öffnet. Profile: fast (zügig), curvy (kurvig, meidet Orte), " +
        "autobahn (Schnellstraße bevorzugt).",
      inputSchema: {
        points: z
          .array(z.string())
          .describe(`Orte oder "lng,lat", von Start bis Ziel (2 bis ${maxPoints})`),
        profile: z.enum(["fast", "curvy", "autobahn"]).optional()
          .describe("Profil für alle Abschnitte, Standard curvy"),
        profiles: z.array(z.enum(["fast", "curvy", "autobahn"])).optional()
          .describe("Ein Profil je Abschnitt; hat Vorrang vor profile"),
        roundTrip: z.boolean().optional().describe("Zurück zum Startpunkt"),
        avoidRoadworks: z.boolean().optional().describe("Baustellen meiden, Standard true"),
        include: z.array(z.enum(["pois", "fuel", "weather"])).optional()
          .describe("Zusätzlich Einkehr, Tankstellen oder Wetter entlang der Route"),
      },
    },
    async (raw) => {
      try {
        const input = validatePlanRoute(raw, maxPoints);
        const resolved = await resolvePoints(api, input.points);

        const coords = resolved.map((r) => r.coord);
        const routingPoints: LngLat[] = input.roundTrip ? [...coords, coords[0]] : coords;
        const segments = segmentCount(coords.length, input.roundTrip);
        const profiles: ProfileName[] =
          input.profiles ?? new Array(segments).fill(input.profile);

        let nogos: NoGo[] = [];
        if (input.avoidRoadworks) {
          try {
            const works = await api.roadworks(coords, true);
            nogos = works.map((w) => ({ lng: w.lng, lat: w.lat, radius: w.radius }));
          } catch {
            // Baustellen sind Zusatzinformation: eine Route ohne sie ist besser als keine.
          }
        }

        const route = await api.route(routingPoints, profiles, nogos);

        const waypoints: DeepLinkWaypoint[] = resolved.map((r, i) => ({
          lng: r.coord[0],
          lat: r.coord[1],
          profile: profiles[i] ?? profiles[0],
          name: r.label,
        }));
        const webUrl = buildDeepLink(publicWebUrl, waypoints, input.roundTrip);

        const parts = [
          formatRouteSummary({
            labels: resolved.map((r) => r.label),
            roundTrip: input.roundTrip,
            profiles,
            route,
            webUrl,
          }),
        ];

        if (input.include.length > 0) {
          const line = extractLine(route.geojson);
          if (line.length < 2) {
            parts.push("Zusatzinfos nicht möglich: die Route hat keine Geometrie.");
          } else {
            for (const extra of input.include) {
              parts.push(await describeExtra(api, extra, line));
            }
          }
        }

        return { content: [{ type: "text", text: parts.join("\n\n") }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

/** Holt die LineString-Koordinaten aus der Backend-Antwort. */
function extractLine(geojson: unknown): LngLat[] {
  const fc = geojson as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] };
  for (const f of fc?.features ?? []) {
    if (f.geometry?.type === "LineString") {
      return (f.geometry.coordinates as LngLat[]) ?? [];
    }
  }
  return [];
}

async function describeExtra(
  api: BackendClient,
  extra: "pois" | "fuel" | "weather",
  line: LngLat[],
): Promise<string> {
  try {
    if (extra === "weather") {
      const res = await api.weather(line, undefined, 5);
      const rows = res.points.map(
        (p) => `  bei ${formatDistance(p.atM)}: ${p.tempMin}–${p.tempMax} °C, ` +
          `${p.precipMm ?? 0} mm, Wind ${p.windMaxKmh ?? 0} km/h`,
      );
      return [`Wetter (${res.date}):`, ...rows].join("\n");
    }
    const category = extra === "fuel" ? "fuel" : "food";
    const found = await api.pois(line, category, 500);
    const title = extra === "fuel" ? "Tankstellen" : "Einkehr";
    if (found.length === 0) return `${title}: keine im 500-m-Umfeld gefunden.`;
    const rows = found
      .slice(0, 10)
      .map((p) => `  ${p.name}${p.brand ? ` (${p.brand})` : ""}, ${Math.round(p.distance)} m`);
    return [`${title} (${found.length} gefunden, die ersten ${rows.length}):`, ...rows].join("\n");
  } catch (err) {
    const why = err instanceof BackendError ? err.message : String(err);
    return `Zusatzinfo "${extra}" nicht verfügbar: ${why}`;
  }
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace mcp`
Expected: todos en verde.

- [ ] **Step 5: Conectar en index.ts y borrar `ping`**

En `mcp/src/index.ts`: eliminar el registro de `ping` y su import de `zod`, e importar
`registerTools` y `backend`:

```ts
import { registerTools } from "./tools.js";
import { backend } from "./backend.js";

const mcp = new McpServer({ name: "motorrad-routenplaner", version: "0.1.0" });
registerTools(mcp, backend, config.publicWebUrl, config.maxPoints);
```

- [ ] **Step 6: Verificar contra el backend real**

Con el backend del despliegue accesible, arrancar el MCP apuntando a él:

```bash
BACKEND_URL=http://192.168.65.9:9640 PUBLIC_WEB_URL=http://192.168.65.9:9640 \
  npm run dev --workspace mcp
```

```bash
curl -s -X POST http://127.0.0.1:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"plan_route","arguments":{"points":["Bilbao","Jaca"],"profile":"curvy"}}}'
```

Expected: texto con distancia, tiempo y una URL `?wp=...`. Guardar esa URL para la Task 10.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/tools.ts mcp/src/index.ts mcp/test/tools.test.ts
git commit -m "feat: Werkzeuge plan_route und geocode_place"
```

---

### Task 9: Parseo del enlace en el frontend

**Files:**
- Create: `frontend/src/deeplink.ts`
- Create: `frontend/test/deeplink.test.ts`
- Modify: `frontend/package.json` (script `test`)

**Interfaces:**
- Produces: `interface ParsedDeepLink { waypoints: Waypoint[]; roundTrip: boolean }` y
  `parseDeepLink(search: string, makeId: () => string): ParsedDeepLink | null`.
  Devuelve `null` cuando no hay nada válido que cargar.

- [ ] **Step 1: Escribir el test que falla**

`frontend/test/deeplink.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeepLink } from "../src/deeplink.js";

let counter = 0;
const makeId = () => `id-${counter++}`;

test("liest zwei Wegpunkte mit Namen", () => {
  const out = parseDeepLink("?wp=-2.935,43.263,curvy,Bilbao;-0.549,42.571,fast,Jaca", makeId);
  assert.ok(out);
  assert.equal(out.waypoints.length, 2);
  assert.equal(out.waypoints[0].label, "Bilbao");
  assert.equal(out.waypoints[0].lng, -2.935);
  assert.equal(out.waypoints[0].profile, "curvy");
  assert.equal(out.waypoints[1].profile, "fast");
  assert.equal(out.roundTrip, false);
});

test("dekodiert Namen mit Sonderzeichen", () => {
  const out = parseDeepLink("?wp=1,2,curvy,Donostia%2C%20Gipuzkoa;3,4,curvy,Sant%20Juli%C3%A0", makeId);
  assert.equal(out?.waypoints[0].label, "Donostia, Gipuzkoa");
  assert.equal(out?.waypoints[1].label, "Sant Julià");
});

test("erkennt die Rundtour", () => {
  const out = parseDeepLink("?wp=1,2,curvy;3,4,curvy&rt=1", makeId);
  assert.equal(out?.roundTrip, true);
});

test("erzeugt ein Label, wenn kein Name im Link steht", () => {
  const out = parseDeepLink("?wp=1,2,curvy;3,4,curvy", makeId);
  assert.ok(out);
  assert.ok(out.waypoints[0].label.length > 0);
});

test("gibt null zurück, wenn kein Parameter da ist", () => {
  assert.equal(parseDeepLink("", makeId), null);
  assert.equal(parseDeepLink("?foo=bar", makeId), null);
});

test("gibt null zurück, wenn weniger als zwei Wegpunkte gültig sind", () => {
  assert.equal(parseDeepLink("?wp=1,2,curvy", makeId), null);
  assert.equal(parseDeepLink("?wp=abc,def,curvy;x,y,z", makeId), null);
});

test("ersetzt ein unbekanntes Profil durch curvy", () => {
  const out = parseDeepLink("?wp=1,2,sport;3,4,curvy", makeId);
  assert.equal(out?.waypoints[0].profile, "curvy");
});

test("überspringt ungültige Einträge, behält die gültigen", () => {
  const out = parseDeepLink("?wp=1,2,curvy;kaputt;3,4,curvy", makeId);
  assert.equal(out?.waypoints.length, 2);
});

test("begrenzt die Anzahl der Wegpunkte", () => {
  const many = Array.from({ length: 40 }, (_, i) => `${i},${i},curvy`).join(";");
  const out = parseDeepLink(`?wp=${many}`, makeId);
  assert.equal(out?.waypoints.length, 25);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Añadir a `frontend/package.json` el script `"test": "tsx --test test/*.test.ts"`.

Run: `npm run test --workspace frontend`
Expected: FALLA, no existe `../src/deeplink.js`.

- [ ] **Step 3: Implementar**

`frontend/src/deeplink.ts`:

```ts
// Liest eine Route aus der Adresszeile: ?wp=lng,lat,profil,name;...[&rt=1]
// Der MCP-Server erzeugt diese Links. Ein fehlerhafter Link darf die App nie
// stoppen: ungültige Einträge werden übersprungen.
import type { ProfileName, Waypoint } from "./types";

const PROFILES: ProfileName[] = ["fast", "curvy", "autobahn"];
/** Schutz gegen absurd lange Links. */
const MAX_WAYPOINTS = 25;

export interface ParsedDeepLink {
  waypoints: Waypoint[];
  roundTrip: boolean;
}

export function parseDeepLink(
  search: string,
  makeId: () => string,
): ParsedDeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("wp");
  if (!raw) return null;

  const waypoints: Waypoint[] = [];
  for (const token of raw.split(";")) {
    if (waypoints.length >= MAX_WAYPOINTS) break;
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

    const profile = PROFILES.includes(parts[2] as ProfileName)
      ? (parts[2] as ProfileName)
      : "curvy";

    let label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (parts.length > 3 && parts[3] !== "") {
      try {
        label = decodeURIComponent(parts.slice(3).join(","));
      } catch {
        // Fehlerhafte Kodierung: bei den Koordinaten als Label bleiben.
      }
    }
    waypoints.push({ id: makeId(), lng, lat, label, profile });
  }

  if (waypoints.length < 2) return null;
  return { waypoints, roundTrip: params.get("rt") === "1" };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace frontend`
Expected: 9 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/src/deeplink.ts frontend/test/deeplink.test.ts
git commit -m "feat: Route aus der Adresszeile lesen"
```

---

### Task 10: Cargar la ruta al abrir la web

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `parseDeepLink` de `frontend/src/deeplink.ts`.
- Produces: nada nuevo; cambia el estado inicial de `waypoints` y `roundTrip`.

- [ ] **Step 1: Poblar el estado inicial desde la URL**

En `frontend/src/App.tsx`, añadir el import:

```ts
import { parseDeepLink } from "./deeplink";
```

Sustituir las dos declaraciones de estado actuales:

```ts
const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
```

y

```ts
const [roundTrip, setRoundTrip] = useState(false);
```

por una lectura única de la URL, hecha con el inicializador diferido de `useState` para
que ocurra una sola vez:

```ts
// Route aus der Adresszeile (vom MCP-Server erzeugter Link). Der verzögerte
// Initialisierer läuft genau einmal – mit useRef würde bei jedem Rendern erneut
// geparst und dabei eine verworfene ID erzeugt.
const [initialLink] = useState(() => parseDeepLink(window.location.search, newId));
const [waypoints, setWaypoints] = useState<Waypoint[]>(initialLink?.waypoints ?? []);
const [roundTrip, setRoundTrip] = useState(initialLink?.roundTrip ?? false);
```

`newId` ya existe en el fichero. Colocar estas líneas donde estaba la declaración de
`waypoints`, y borrar la de `roundTrip` de su posición actual.

El `useEffect` de routing existente calcula la ruta en cuanto hay dos puntos, así que no
hace falta ningún disparo adicional.

- [ ] **Step 2: Comprobar tipos**

Run: `npm run build --workspace frontend`
Expected: sin errores.

- [ ] **Step 3: Verificar en el navegador**

```bash
npm run dev
```

Abrir la URL generada en la Task 8, cambiando el host por `localhost:5173`. Comprobar:

1. Los waypoints aparecen en la barra lateral con sus nombres.
2. La ruta se dibuja sin tocar nada.
3. El perfil de cada tramo es el del enlace.
4. Abrir `http://localhost:5173/?wp=roto` no rompe la aplicación: arranca vacía.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: Route beim Laden aus dem Link übernehmen"
```

---

### Task 11: Imagen y servicio en el compose

**Files:**
- Create: `Dockerfile.mcp`
- Modify: `docker-compose.server.yml`
- Modify: `.env.example`
- Modify: `.dockerignore` (excluir `mcp/dist`)

**Interfaces:**
- Consumes: el workspace `mcp` construido.
- Produces: servicio `motorrad-routenplaner-mcp`, publicado en `${MCP_BIND}:${MCP_PORT_HOST}:8081`.

- [ ] **Step 1: Escribir el Dockerfile**

`Dockerfile.mcp`:

```dockerfile
# Baut den MCP-Server und liefert ein schlankes Laufzeit-Image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/
COPY backend/package.json ./backend/
RUN npm ci --workspace mcp --include-workspace-root
# backend/src wird nur für die Typprüfung des Vertrags gebraucht.
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/
COPY mcp ./mcp
RUN npm run build --workspace mcp

FROM node:22-slim
WORKDIR /app/mcp
COPY --from=build /app/mcp/package.json ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/mcp/dist ./dist
USER node
EXPOSE 8081
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Añadir el servicio al compose**

En `docker-compose.server.yml`, tras el servicio del backend:

```yaml
  motorrad-routenplaner-mcp:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    image: local/motorrad-routenplaner-mcp:server
    container_name: motorrad-routenplaner-mcp
    restart: unless-stopped
    depends_on:
      motorrad-routenplaner-backend:
        condition: service_healthy
    environment:
      MCP_PORT: "8081"
      # Im Container auf allen Interfaces lauschen, sonst kommt Docker nicht durch.
      MCP_HOST: "0.0.0.0"
      BACKEND_URL: "http://motorrad-routenplaner-backend:8080"
      PUBLIC_WEB_URL: "${PUBLIC_WEB_URL:-http://127.0.0.1:9640}"
      ROUTE_TIMEOUT_MS: "${ROUTE_TIMEOUT_MS:-180000}"
    ports:
      - "${MCP_BIND:-127.0.0.1}:${MCP_PORT_HOST:-9641}:8081"
    healthcheck:
      # Echter JSON-RPC-initialize: prüft Transport und Server zugleich.
      test:
        - CMD
        - node
        - -e
        - |
          const body = JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"healthcheck",version:"0"}}});
          fetch("http://127.0.0.1:8081/mcp",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json, text/event-stream"},body})
            .then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Documentar las variables**

Añadir a `.env.example`:

```bash
# Servidor MCP (planificación de rutas para agentes).
# Dirección y puerto de publicación; PUBLIC_WEB_URL es la base de los enlaces
# que devuelve, así que debe ser la URL con la que tú abres la web.
MCP_BIND=127.0.0.1
MCP_PORT_HOST=9641
PUBLIC_WEB_URL=http://127.0.0.1:9640
```

Añadir `mcp/dist` a `.dockerignore`.

- [ ] **Step 4: Construir y levantar**

```bash
docker compose -f docker-compose.server.yml build motorrad-routenplaner-mcp
docker compose -f docker-compose.server.yml up -d motorrad-routenplaner-mcp
docker compose -f docker-compose.server.yml ps
```

Expected: el contenedor llega a `healthy`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.mcp docker-compose.server.yml .env.example .dockerignore
git commit -m "feat: MCP-Server als Container im Server-Deployment"
```

---

### Task 12: Validación en el servidor y documentación

**Files:**
- Modify: `CLAUDE.md`
- Modify: `config/config.yaml`

**Interfaces:**
- Consumes: el despliegue completo.
- Produces: documentación y la ficha en la wiki.

- [ ] **Step 1: Desplegar en el servidor**

```bash
ssh server_ia 'cd /home/chispas/herramientas/motorrad-routenplaner
  git fetch origin -q && git reset --hard origin/main -q
  grep -q MCP_BIND .env || printf "\nMCP_BIND=192.168.65.9\nMCP_PORT_HOST=9641\nPUBLIC_WEB_URL=http://192.168.65.9:9640\n" >> .env
  docker compose -f docker-compose.server.yml up -d --build
  docker compose -f docker-compose.server.yml ps'
```

Expected: cuatro contenedores `healthy`.

- [ ] **Step 2: Validar el protocolo**

```bash
ssh server_ia 'curl -s -X POST http://192.168.65.9:9641/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"curl\",\"version\":\"0\"}}}"'
```

Expected: `serverInfo.name` es `motorrad-routenplaner`.
Después, `tools/list` debe devolver exactamente `plan_route` y `geocode_place`.

- [ ] **Step 3: Validar una ruta real y el enlace**

Llamar a `plan_route` con `{"points":["Bilbao","Jaca"],"profile":"curvy"}`.
Expected: distancia coherente con la que da la web, y una URL `?wp=...`.
Abrir esa URL en el navegador: la ruta aparece dibujada con sus nombres.

- [ ] **Step 4: Validar el error de cobertura**

Llamar a `plan_route` con `{"points":["Bilbao","Berlin"]}`.
Expected: mensaje sobre las kacheln cargadas, **no** un 502 ni un error opaco.

- [ ] **Step 5: Documentar**

En `CLAUDE.md`, añadir el workspace `mcp` a la estructura, el comando `npm test`, y una
sección corta sobre el servidor MCP: las dos herramientas, el formato del enlace y el
hecho de que el MCP no contiene lógica de routing.

En `config/config.yaml`, añadir el bloque del servicio MCP con su puerto y su URL pública.

- [ ] **Step 6: Ficha en la wiki**

Crear `/wiki/entities/mcps/motorrad-routenplaner-en-server_ia.md` en la base `mcp`,
siguiendo el formato de la ficha de Obscura: instalación real, endpoints, validación, uso
desde agentes, operación, actualización y criterio de seguridad. Añadir la línea
correspondiente al `log.md` de esa wiki y actualizar su `overview.md`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md config/config.yaml
git commit -m "docs: MCP-Server dokumentiert"
```

---

## Self-review

**Cobertura de la spec.** Cada sección de la spec tiene tarea: objetivo y decisiones
(Tasks 1–11), herramientas (Task 8), enlace (Tasks 4, 9, 10), cambio en el frontend
(Tasks 9, 10), configuración (Task 3), despliegue (Task 11), errores (Task 6 para la
traducción, Task 8 para la presentación al agente), pruebas (Tasks 3–9 unitarias, Task 12
de extremo a extremo), riesgos (el límite de puntos se aplica en Task 5 y se comunica en
su mensaje de error).

Un punto de la spec se implementa de otro modo: el acoplamiento de tipos por importación
directa se sustituye por un contrato comprobado con `tsc --noEmit` (Task 2), porque
importar entre workspaces rompe la emisión de JavaScript. El efecto buscado —que un cambio
incompatible del backend rompa el build del MCP— se mantiene.

**Consistencia de nombres.** `segmentCount`, `validatePlanRoute`, `ToolInputError`,
`BackendError`, `createBackendClient`, `buildDeepLink`, `DeepLinkWaypoint`,
`formatRouteSummary`, `formatDistance`, `formatDuration`, `resolvePoints`,
`registerTools`, `parseDeepLink`, `ParsedDeepLink` se usan con la misma firma en todas las
tareas donde aparecen. `config` expone `port`, `host`, `backendUrl`, `publicWebUrl`,
`routeTimeoutMs`, `maxPoints`, y así se consume en las Tasks 1, 6 y 8.

**Riesgo asumido.** La firma exacta de `registerTool`, `inputSchema` y
`transport.handleRequest` en el SDK 1.30.0 se verifica en la Task 1, Step 3, antes de
escribir lógica de dominio. Si difiere, se corrige allí y se anota en este plan.
