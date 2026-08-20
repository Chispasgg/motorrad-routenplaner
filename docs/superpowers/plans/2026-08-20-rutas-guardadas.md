# Rutas guardadas en SQLite — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardar rutas en SQLite y volver a cargarlas desde un apartado de la barra lateral, con las acciones de cargar, renombrar, duplicar y borrar.

**Architecture:** Un único módulo del backend conoce SQLite (`routeStore.ts`) y expone cinco operaciones sobre una tabla con los waypoints en JSON. Cinco endpoints REST lo publican. El frontend añade un botón de guardar junto al de GPX y una tarjeta plegable con la lista; cargar una ruta reutiliza el camino que ya existe para los enlaces del MCP.

**Tech Stack:** `node:sqlite` de la biblioteca estándar (sin dependencias nuevas), Fastify, React, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-rutas-guardadas-design.md`

## Global Constraints

- `node:sqlite` de la biblioteca estándar. **Prohibido** añadir `better-sqlite3`, `sql.js`, un ORM o cualquier otra dependencia de base de datos.
- Verificado que `node:sqlite` funciona sin indicadores en `node:22-slim` (v22.23.2), la imagen de los contenedores. Emite un `ExperimentalWarning` que es esperado.
- Todo el acceso a SQLite vive en `backend/src/services/routeStore.ts`. Ningún otro fichero importa `node:sqlite`.
- Runner de tests: `tsx --test`. Prohibido vitest o jest.
- Comentarios y mensajes de commit en alemán, como el resto del repositorio.
- Textos de interfaz solo por claves de `frontend/src/i18n.tsx`, en los tres idiomas, con `de` como referencia.
- Ningún módulo salvo `backend/src/config.ts` lee `process.env` en el backend.
- Fechas en ISO 8601 y UTC. `created_at` nunca cambia; `updated_at` se refresca al actualizar.
- Límites de validación: nombre entre 1 y 120 caracteres, mínimo 2 waypoints, perfiles válidos `fast`, `curvy`, `autobahn`, longitud entre -180 y 180, latitud entre -90 y 90.
- Si la base de datos no se puede abrir, los endpoints de rutas responden 503 y **el resto de la aplicación sigue funcionando**.
- Sin ventanas modales: el patrón del proyecto es todo en línea en la barra lateral.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `backend/src/services/routeStore.ts` | Esquema y operaciones; único módulo que conoce SQLite |
| `backend/test/routeStore.test.ts` | Pruebas del almacén |
| `backend/src/config.ts` | `routesDbPath` |
| `backend/package.json` | Script `test` |
| `backend/src/index.ts` | Los cinco endpoints |
| `frontend/src/routeName.ts` | Nombre propuesto a partir de los waypoints |
| `frontend/test/routeName.test.ts` | Pruebas del nombre |
| `frontend/src/types.ts` | Tipos de ruta guardada |
| `frontend/src/api/client.ts` | Cliente de los cinco endpoints |
| `frontend/src/components/Sidebar.tsx` | Botón de guardar y tarjeta de la lista |
| `frontend/src/App.tsx` | Estado y operaciones |
| `frontend/src/i18n.tsx` | Textos en tres idiomas |
| `frontend/src/index.css` | Fila de botones y lista |
| `docker-compose.server.yml` | Volumen persistente |
| `.env.example`, `config/config.yaml`, `CLAUDE.md` | Documentación |

---

### Task 1: Almacén SQLite

Pieza central y aislada. Se hace primero porque todo lo demás depende de su contrato, y
porque es donde vive el riesgo (API experimental).

**Files:**
- Create: `backend/src/services/routeStore.ts`
- Create: `backend/test/routeStore.test.ts`
- Modify: `backend/package.json` (script `test`)
- Modify: `backend/src/config.ts` (añadir `routesDbPath`)
- Modify: `package.json` (raíz: incluir backend en el script `test`)

**Interfaces:**
- Consumes: `ProfileName` de `backend/src/types.ts`.
- Produces: `StoredWaypoint`, `StoredRouteSummary`, `StoredRoute`, `RouteStore`,
  `RouteStoreError`, y `createRouteStore(dbPath: string, now?: () => string): RouteStore`.

- [ ] **Step 1: Escribir el test que falla**

`backend/test/routeStore.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRouteStore, RouteStoreError } from "../src/services/routeStore.js";
import type { StoredWaypoint } from "../src/services/routeStore.js";

/** Legt einen Store in einem temporären Verzeichnis an und räumt danach auf. */
function withStore(
  run: (store: ReturnType<typeof createRouteStore>) => void,
  now?: () => string,
): void {
  const dir = mkdtempSync(join(tmpdir(), "routestore-"));
  try {
    run(createRouteStore(join(dir, "routes.db"), now));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WPS: StoredWaypoint[] = [
  { lng: -2.935, lat: 43.263, label: "Bilbao", profile: "curvy" },
  { lng: -2.679, lat: 43.316, label: "Gernika", profile: "fast" },
];

test("legt eine Route an und liest sie unverändert zurück", () => {
  withStore((store) => {
    const created = store.create({ name: "Bilbao → Gernika", roundTrip: false, waypoints: WPS });
    assert.ok(created.id > 0);
    const read = store.get(created.id);
    assert.equal(read?.name, "Bilbao → Gernika");
    assert.equal(read?.roundTrip, false);
    assert.deepEqual(read?.waypoints, WPS);
  });
});

test("liefert in der Liste eine Zusammenfassung ohne Wegpunkte", () => {
  withStore((store) => {
    store.create({ name: "Eine", roundTrip: true, waypoints: WPS });
    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].pointCount, 2);
    assert.equal(list[0].roundTrip, true);
    assert.equal("waypoints" in list[0], false);
  });
});

test("aktualisiert updated_at und lässt created_at unberührt", () => {
  const stamps = ["2026-01-01T00:00:00.000Z", "2026-06-15T12:30:00.000Z"];
  let i = 0;
  withStore((store) => {
    const created = store.create({ name: "Alt", roundTrip: false, waypoints: WPS });
    assert.equal(created.createdAt, stamps[0]);
    const updated = store.update(created.id, { name: "Neu" });
    assert.equal(updated?.name, "Neu");
    assert.equal(updated?.createdAt, stamps[0]);
    assert.equal(updated?.updatedAt, stamps[1]);
  }, () => stamps[Math.min(i++, stamps.length - 1)]);
});

test("ändert beim Umbenennen die Wegpunkte nicht", () => {
  withStore((store) => {
    const created = store.create({ name: "Alt", roundTrip: false, waypoints: WPS });
    const updated = store.update(created.id, { name: "Neu" });
    assert.deepEqual(updated?.waypoints, WPS);
  });
});

test("ersetzt beim Aktualisieren der Wegpunkte den Namen nicht", () => {
  withStore((store) => {
    const created = store.create({ name: "Behalten", roundTrip: false, waypoints: WPS });
    const andere: StoredWaypoint[] = [
      { lng: 1, lat: 2, label: "A", profile: "fast" },
      { lng: 3, lat: 4, label: "B", profile: "fast" },
      { lng: 5, lat: 6, label: "C", profile: "curvy" },
    ];
    const updated = store.update(created.id, { waypoints: andere });
    assert.equal(updated?.name, "Behalten");
    assert.equal(updated?.waypoints.length, 3);
  });
});

test("löscht einmal erfolgreich und danach nicht mehr", () => {
  withStore((store) => {
    const created = store.create({ name: "Weg", roundTrip: false, waypoints: WPS });
    assert.equal(store.remove(created.id), true);
    assert.equal(store.remove(created.id), false);
    assert.equal(store.get(created.id), null);
  });
});

test("gibt bei unbekannter Kennung null zurück statt zu werfen", () => {
  withStore((store) => {
    assert.equal(store.get(9999), null);
    assert.equal(store.update(9999, { name: "X" }), null);
  });
});

test("weist einen leeren oder zu langen Namen ab", () => {
  withStore((store) => {
    assert.throws(() => store.create({ name: "  ", roundTrip: false, waypoints: WPS }), RouteStoreError);
    const lang = "x".repeat(121);
    assert.throws(() => store.create({ name: lang, roundTrip: false, waypoints: WPS }), RouteStoreError);
  });
});

test("verlangt mindestens zwei Wegpunkte", () => {
  withStore((store) => {
    assert.throws(
      () => store.create({ name: "Kurz", roundTrip: false, waypoints: [WPS[0]] }),
      RouteStoreError,
    );
  });
});

test("weist ungültige Profile und Koordinaten ab", () => {
  withStore((store) => {
    assert.throws(
      () => store.create({
        name: "Falsch",
        roundTrip: false,
        waypoints: [WPS[0], { lng: 0, lat: 0, label: "X", profile: "sport" as never }],
      }),
      RouteStoreError,
    );
    assert.throws(
      () => store.create({
        name: "Falsch",
        roundTrip: false,
        waypoints: [WPS[0], { lng: 999, lat: 0, label: "X", profile: "fast" }],
      }),
      RouteStoreError,
    );
  });
});

test("überlebt das Schließen und erneute Öffnen der Datei", () => {
  const dir = mkdtempSync(join(tmpdir(), "routestore-"));
  try {
    const path = join(dir, "routes.db");
    const first = createRouteStore(path);
    const created = first.create({ name: "Bleibt", roundTrip: false, waypoints: WPS });
    const second = createRouteStore(path);
    assert.equal(second.get(created.id)?.name, "Bleibt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Añadir los scripts de test y ejecutar para ver el fallo**

En `backend/package.json`, añadir a `scripts`:

```json
"test": "tsx --test test/*.test.ts"
```

En el `package.json` de la raíz, ampliar el script `test` para que quede así:

```json
"test": "npm run test --workspace backend && npm run test --workspace mcp && npm run test --workspace frontend"
```

Run: `npm run test --workspace backend`
Expected: FALLA, no existe `../src/services/routeStore.js`.

- [ ] **Step 3: Implementar el almacén**

`backend/src/services/routeStore.ts`:

```ts
// Speichert Routen in SQLite. Einziges Modul, das node:sqlite kennt.
// Die Wegpunkte liegen als JSON in einer Spalte: eine Route wird immer komplett
// gelesen, deshalb bringt eine eigene Tabelle keinen Vorteil.
import { DatabaseSync } from "node:sqlite";
import type { ProfileName } from "../types.js";

export class RouteStoreError extends Error {}

const PROFILES: ProfileName[] = ["fast", "curvy", "autobahn"];
const NAME_MAX = 120;
const MIN_WAYPOINTS = 2;

export interface StoredWaypoint {
  lng: number;
  lat: number;
  label: string;
  profile: ProfileName;
}

export interface StoredRouteSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  roundTrip: boolean;
  pointCount: number;
}

export interface StoredRoute extends StoredRouteSummary {
  waypoints: StoredWaypoint[];
}

export interface CreateInput {
  name: string;
  roundTrip: boolean;
  waypoints: StoredWaypoint[];
}

export interface UpdatePatch {
  name?: string;
  roundTrip?: boolean;
  waypoints?: StoredWaypoint[];
}

export interface RouteStore {
  list(): StoredRouteSummary[];
  get(id: number): StoredRoute | null;
  create(input: CreateInput): StoredRoute;
  update(id: number, patch: UpdatePatch): StoredRoute | null;
  remove(id: number): boolean;
}

function checkName(name: unknown): string {
  if (typeof name !== "string") throw new RouteStoreError("Der Name fehlt.");
  const trimmed = name.trim();
  if (trimmed === "") throw new RouteStoreError("Der Name darf nicht leer sein.");
  if (trimmed.length > NAME_MAX) {
    throw new RouteStoreError(`Der Name darf höchstens ${NAME_MAX} Zeichen haben.`);
  }
  return trimmed;
}

function checkWaypoints(waypoints: unknown): StoredWaypoint[] {
  if (!Array.isArray(waypoints) || waypoints.length < MIN_WAYPOINTS) {
    throw new RouteStoreError(`Es sind mindestens ${MIN_WAYPOINTS} Wegpunkte nötig.`);
  }
  return waypoints.map((w, i) => {
    const p = w as Partial<StoredWaypoint>;
    if (typeof p.lng !== "number" || p.lng < -180 || p.lng > 180) {
      throw new RouteStoreError(`Wegpunkt ${i}: Längengrad ungültig.`);
    }
    if (typeof p.lat !== "number" || p.lat < -90 || p.lat > 90) {
      throw new RouteStoreError(`Wegpunkt ${i}: Breitengrad ungültig.`);
    }
    if (!PROFILES.includes(p.profile as ProfileName)) {
      throw new RouteStoreError(`Wegpunkt ${i}: Profil ungültig.`);
    }
    return {
      lng: p.lng,
      lat: p.lat,
      label: typeof p.label === "string" ? p.label : "",
      profile: p.profile as ProfileName,
    };
  });
}

/** Zeile der Tabelle, wie SQLite sie liefert (Objekt ohne Prototyp). */
interface Row {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  round_trip: number;
  waypoints: string;
}

function toRoute(row: Row): StoredRoute {
  const waypoints = JSON.parse(row.waypoints) as StoredWaypoint[];
  return {
    id: Number(row.id),
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roundTrip: row.round_trip === 1,
    pointCount: waypoints.length,
    waypoints,
  };
}

/**
 * Öffnet die Datenbank und legt das Schema an. `now` ist injizierbar, damit die
 * Tests die Zeitstempel kontrollieren können.
 */
export function createRouteStore(
  dbPath: string,
  now: () => string = () => new Date().toISOString(),
): RouteStore {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL,
      round_trip INTEGER NOT NULL DEFAULT 0,
      waypoints  TEXT    NOT NULL
    )
  `);

  function readRow(id: number): Row | null {
    const row = db.prepare("SELECT * FROM routes WHERE id = ?").get(id) as Row | undefined;
    return row ?? null;
  }

  return {
    list() {
      const rows = db
        .prepare("SELECT * FROM routes ORDER BY updated_at DESC")
        .all() as Row[];
      // Die Zusammenfassung enthält bewusst keine Wegpunkte.
      return rows.map((row) => {
        const { waypoints, ...rest } = toRoute(row);
        void waypoints;
        return rest;
      });
    },

    get(id) {
      const row = readRow(id);
      return row ? toRoute(row) : null;
    },

    create(input) {
      const name = checkName(input.name);
      const waypoints = checkWaypoints(input.waypoints);
      const stamp = now();
      const result = db
        .prepare(
          "INSERT INTO routes (name, created_at, updated_at, round_trip, waypoints) " +
            "VALUES (?, ?, ?, ?, ?)",
        )
        .run(name, stamp, stamp, input.roundTrip ? 1 : 0, JSON.stringify(waypoints));
      const id = Number(result.lastInsertRowid);
      return toRoute(readRow(id)!);
    },

    update(id, patch) {
      const existing = readRow(id);
      if (!existing) return null;
      const name = patch.name === undefined ? existing.name : checkName(patch.name);
      const waypoints =
        patch.waypoints === undefined
          ? (JSON.parse(existing.waypoints) as StoredWaypoint[])
          : checkWaypoints(patch.waypoints);
      const roundTrip =
        patch.roundTrip === undefined ? existing.round_trip === 1 : patch.roundTrip;
      db.prepare(
        "UPDATE routes SET name = ?, updated_at = ?, round_trip = ?, waypoints = ? WHERE id = ?",
      ).run(name, now(), roundTrip ? 1 : 0, JSON.stringify(waypoints), id);
      return toRoute(readRow(id)!);
    },

    remove(id) {
      const result = db.prepare("DELETE FROM routes WHERE id = ?").run(id);
      return Number(result.changes) > 0;
    },
  };
}
```

- [ ] **Step 4: Añadir la configuración**

En `backend/src/config.ts`, dentro del objeto `config`, añadir:

```ts
  // Datei der Routen-Datenbank. Im Container liegt sie auf einem Volume.
  routesDbPath: process.env.ROUTES_DB_PATH ?? resolve(here, "..", "data", "routes.db"),
```

`resolve` y `here` ya existen en ese fichero.

- [ ] **Step 5: Ejecutar los tests**

Run: `npm run test --workspace backend`
Expected: 11 tests en verde.

- [ ] **Step 6: Comprobar tipos**

Run: `npm run build --workspace backend`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/routeStore.ts backend/test/routeStore.test.ts \
  backend/src/config.ts backend/package.json package.json
git commit -m "feat: Routen-Speicher auf SQLite-Basis"
```

---

### Task 2: Endpoints del backend

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createRouteStore`, `RouteStoreError`, `StoredWaypoint` de la Task 1; `config.routesDbPath`.
- Produces: `GET /api/routes`, `GET /api/routes/:id`, `POST /api/routes`,
  `PUT /api/routes/:id`, `DELETE /api/routes/:id`.

No hay pruebas unitarias de los endpoints: la lógica y la validación viven en el almacén,
que ya está cubierto, y el backend se verifica en este proyecto por tipos más comprobación
real con `curl`, como el resto de su API. El Step 4 hace esa comprobación.

- [ ] **Step 1: Abrir el almacén de forma tolerante a fallos**

En `backend/src/index.ts`, tras los imports existentes, añadir:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createRouteStore, RouteStoreError, type RouteStore, type StoredWaypoint,
} from "./services/routeStore.js";
```

Y después de la creación de `app`:

```ts
// Der Speicher ist eine Nebenfunktion: lässt sich die Datenbank nicht öffnen,
// bleibt die Routenplanung nutzbar und nur /api/routes antwortet mit 503.
let routeStore: RouteStore | null = null;
let routeStoreError: string | null = null;
try {
  mkdirSync(dirname(config.routesDbPath), { recursive: true });
  routeStore = createRouteStore(config.routesDbPath);
} catch (err) {
  routeStoreError = String((err as Error).message ?? err);
  console.error("Routen-Speicher nicht verfügbar:", routeStoreError);
}

/** Liefert den Speicher oder beantwortet die Anfrage mit 503. */
function storeOr503(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): RouteStore | null {
  if (routeStore) return routeStore;
  reply.code(503).send({
    error: `Der Routen-Speicher ist nicht verfügbar: ${routeStoreError ?? "unbekannt"}`,
  });
  return null;
}
```

- [ ] **Step 2: Añadir los cinco endpoints**

Insertar antes del bloque de servido estático (el comentario
`// --- Statisches Frontend ausliefern ---`):

```ts
// --- Gespeicherte Routen ----------------------------------------------------
app.get("/api/routes", async (_req, reply) => {
  const store = storeOr503(reply);
  if (!store) return;
  return store.list();
});

app.get<{ Params: { id: string } }>("/api/routes/:id", async (req, reply) => {
  const store = storeOr503(reply);
  if (!store) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige Kennung." });
  const route = store.get(id);
  if (!route) return reply.code(404).send({ error: "Route nicht gefunden." });
  return route;
});

app.post<{ Body: { name?: string; roundTrip?: boolean; waypoints?: StoredWaypoint[] } }>(
  "/api/routes",
  async (req, reply) => {
    const store = storeOr503(reply);
    if (!store) return;
    const { name, roundTrip = false, waypoints } = req.body ?? {};
    try {
      return store.create({ name: name as string, roundTrip, waypoints: waypoints ?? [] });
    } catch (err) {
      if (err instanceof RouteStoreError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  },
);

app.put<{
  Params: { id: string };
  Body: { name?: string; roundTrip?: boolean; waypoints?: StoredWaypoint[] };
}>("/api/routes/:id", async (req, reply) => {
  const store = storeOr503(reply);
  if (!store) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige Kennung." });
  try {
    const updated = store.update(id, req.body ?? {});
    if (!updated) return reply.code(404).send({ error: "Route nicht gefunden." });
    return updated;
  } catch (err) {
    if (err instanceof RouteStoreError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.delete<{ Params: { id: string } }>("/api/routes/:id", async (req, reply) => {
  const store = storeOr503(reply);
  if (!store) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige Kennung." });
  if (!store.remove(id)) return reply.code(404).send({ error: "Route nicht gefunden." });
  return { ok: true };
});
```

- [ ] **Step 3: Comprobar tipos**

Run: `npm run build --workspace backend`
Expected: sin errores.

- [ ] **Step 4: Verificar con peticiones reales**

Arrancar el backend con una base de datos temporal:

```bash
ROUTES_DB_PATH=/tmp/routes-test.db npm run dev --workspace backend
```

En otra terminal, la secuencia completa:

```bash
# crear
curl -s -X POST http://127.0.0.1:8080/api/routes -H "Content-Type: application/json" \
  -d '{"name":"Prueba","roundTrip":false,"waypoints":[
       {"lng":-2.935,"lat":43.263,"label":"Bilbao","profile":"curvy"},
       {"lng":-2.679,"lat":43.316,"label":"Gernika","profile":"fast"}]}'
# listar
curl -s http://127.0.0.1:8080/api/routes
# obtener (id 1)
curl -s http://127.0.0.1:8080/api/routes/1
# renombrar
curl -s -X PUT http://127.0.0.1:8080/api/routes/1 -H "Content-Type: application/json" \
  -d '{"name":"Renombrada"}'
# nombre vacío -> 400
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://127.0.0.1:8080/api/routes/1 \
  -H "Content-Type: application/json" -d '{"name":"  "}'
# inexistente -> 404
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/routes/9999
# borrar
curl -s -X DELETE http://127.0.0.1:8080/api/routes/1
```

Expected: crear devuelve la ruta con `id`, `createdAt` y `updatedAt`; listar devuelve un
elemento **sin** campo `waypoints`; renombrar cambia `updatedAt` y no `createdAt`; nombre
vacío da `400`; inexistente da `404`; borrar da `{"ok":true}`.

Comprobar también el caso degradado, que es el que la spec exige:

```bash
ROUTES_DB_PATH=/proc/version/imposible.db npm run dev --workspace backend
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/routes   # 503
curl -s http://127.0.0.1:8080/api/health                                    # {"ok":true}
```

Expected: `/api/routes` responde `503` y `/api/health` sigue devolviendo `{"ok":true}`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: Endpunkte für gespeicherte Routen"
```

---

### Task 3: Nombre propuesto

**Files:**
- Create: `frontend/src/routeName.ts`
- Create: `frontend/test/routeName.test.ts`

**Interfaces:**
- Produces: `suggestRouteName(labels: string[], roundTrip: boolean): string`.

- [ ] **Step 1: Escribir el test que falla**

`frontend/test/routeName.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestRouteName } from "../src/routeName.js";

test("verbindet Start und Ziel", () => {
  assert.equal(suggestRouteName(["Bilbao", "Gernika"], false), "Bilbao → Gernika");
});

test("markiert eine Rundtour", () => {
  assert.equal(suggestRouteName(["Bilbao", "Gernika"], true), "Rundtour Bilbao");
});

test("nennt bei Zwischenzielen deren Anzahl", () => {
  assert.equal(
    suggestRouteName(["Bilbao", "Durango", "Gernika"], false),
    "Bilbao → Gernika (1 Zwischenziel)",
  );
  assert.equal(
    suggestRouteName(["A", "B", "C", "D"], false),
    "A → D (2 Zwischenziele)",
  );
});

test("kürzt sehr lange Ortsnamen", () => {
  const lang = "Donostia / San Sebastián, Gipuzkoa, Euskadi, España";
  const name = suggestRouteName([lang, lang], false);
  assert.ok(name.length <= 120, `zu lang: ${name.length}`);
  assert.ok(name.includes("→"), name);
});

test("kommt mit leeren Bezeichnungen zurecht", () => {
  assert.equal(suggestRouteName(["", ""], false), "Route");
});

test("gibt bei zu wenigen Punkten einen neutralen Namen zurück", () => {
  assert.equal(suggestRouteName([], false), "Route");
  assert.equal(suggestRouteName(["Nur einer"], false), "Route");
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test --workspace frontend`
Expected: FALLA, no existe `../src/routeName.js`.

- [ ] **Step 3: Implementar**

`frontend/src/routeName.ts`:

```ts
// Schlägt einen Namen für eine zu speichernde Route vor. Reine Logik, damit sie
// ohne React testbar bleibt.

/** Grenze des Namensfeldes im Backend. */
const NAME_MAX = 120;

/** Nimmt den ersten Teil vor dem Komma: "Bilbao, Bizkaia, ..." -> "Bilbao". */
function shortLabel(label: string): string {
  const first = label.split(",")[0]?.trim() ?? "";
  return first;
}

export function suggestRouteName(labels: string[], roundTrip: boolean): string {
  const short = labels.map(shortLabel).filter((l) => l !== "");
  if (short.length < 2) return "Route";

  const start = short[0];
  const end = short[short.length - 1];
  const between = short.length - 2;

  let name = roundTrip ? `Rundtour ${start}` : `${start} → ${end}`;
  if (!roundTrip && between > 0) {
    name += ` (${between} ${between === 1 ? "Zwischenziel" : "Zwischenziele"})`;
  }
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX - 1).trimEnd() + "…" : name;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test --workspace frontend`
Expected: los 6 tests nuevos en verde, más los 9 que ya existían.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routeName.ts frontend/test/routeName.test.ts
git commit -m "feat: Namensvorschlag für gespeicherte Routen"
```

---

### Task 4: Guardar desde la interfaz

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/i18n.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `suggestRouteName` de la Task 3; los endpoints de la Task 2.
- Produces: en `client.ts`, `listRoutes`, `getRoute`, `createRoute`, `updateRoute`,
  `deleteRoute`; en `types.ts`, `SavedRouteSummary` y `SavedRoute`.

- [ ] **Step 1: Añadir los tipos**

Al final de `frontend/src/types.ts`:

```ts
export interface SavedWaypoint {
  lng: number;
  lat: number;
  label: string;
  profile: ProfileName;
}

export interface SavedRouteSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  roundTrip: boolean;
  pointCount: number;
}

export interface SavedRoute extends SavedRouteSummary {
  waypoints: SavedWaypoint[];
}
```

- [ ] **Step 2: Añadir el cliente**

En `frontend/src/api/client.ts`, ampliar el import de tipos con `SavedRoute`,
`SavedRouteSummary` y `SavedWaypoint`, y añadir al final:

```ts
/** Fehlertext aus einer Antwort ziehen, sonst den Statuscode nennen. */
async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Fehler ${res.status}`;
}

export async function listRoutes(): Promise<SavedRouteSummary[]> {
  const res = await fetch("/api/routes");
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function getRoute(id: number): Promise<SavedRoute> {
  const res = await fetch(`/api/routes/${id}`);
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function createRoute(
  name: string,
  roundTrip: boolean,
  waypoints: SavedWaypoint[],
): Promise<SavedRoute> {
  return post<SavedRoute>("/api/routes", { name, roundTrip, waypoints });
}

export async function updateRoute(
  id: number,
  patch: { name?: string; roundTrip?: boolean; waypoints?: SavedWaypoint[] },
): Promise<SavedRoute> {
  const res = await fetch(`/api/routes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function deleteRoute(id: number): Promise<void> {
  const res = await fetch(`/api/routes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorText(res));
}
```

- [ ] **Step 3: Añadir los textos en los tres idiomas**

En `frontend/src/i18n.tsx`, en el diccionario `de`, justo antes de `"wp.title"`:

```ts
  "saved.title": "Gespeicherte Routen",
  "saved.save": "Route speichern",
  "saved.saveAsNew": "Als neue speichern",
  "saved.update": "Route aktualisieren",
  "saved.namePlaceholder": "Name der Route …",
  "saved.confirm": "Speichern",
  "saved.cancel": "Abbrechen",
  "saved.empty": "Noch keine Routen gespeichert.",
  "saved.load": "laden",
  "saved.rename": "umbenennen",
  "saved.duplicate": "duplizieren",
  "saved.remove": "löschen",
  "saved.confirmRemove": "Wirklich löschen?",
  "saved.points": "{n} Punkte",
  "saved.updatedAt": "geändert {date}",
  "saved.copySuffix": "(Kopie)",
  "saved.unavailable": "Der Speicher ist nicht verfügbar.",
  "saved.needRoute": "Erst eine Route mit mindestens zwei Punkten anlegen.",
```

En `en`, en la misma posición relativa:

```ts
  "saved.title": "Saved routes",
  "saved.save": "Save route",
  "saved.saveAsNew": "Save as new",
  "saved.update": "Update route",
  "saved.namePlaceholder": "Route name …",
  "saved.confirm": "Save",
  "saved.cancel": "Cancel",
  "saved.empty": "No routes saved yet.",
  "saved.load": "load",
  "saved.rename": "rename",
  "saved.duplicate": "duplicate",
  "saved.remove": "delete",
  "saved.confirmRemove": "Really delete?",
  "saved.points": "{n} points",
  "saved.updatedAt": "changed {date}",
  "saved.copySuffix": "(copy)",
  "saved.unavailable": "The store is unavailable.",
  "saved.needRoute": "Create a route with at least two points first.",
```

En `es`:

```ts
  "saved.title": "Rutas guardadas",
  "saved.save": "Guardar ruta",
  "saved.saveAsNew": "Guardar como nueva",
  "saved.update": "Actualizar ruta",
  "saved.namePlaceholder": "Nombre de la ruta …",
  "saved.confirm": "Guardar",
  "saved.cancel": "Cancelar",
  "saved.empty": "Todavía no hay rutas guardadas.",
  "saved.load": "cargar",
  "saved.rename": "renombrar",
  "saved.duplicate": "duplicar",
  "saved.remove": "borrar",
  "saved.confirmRemove": "¿Borrar de verdad?",
  "saved.points": "{n} puntos",
  "saved.updatedAt": "modificada {date}",
  "saved.copySuffix": "(copia)",
  "saved.unavailable": "El almacén no está disponible.",
  "saved.needRoute": "Crea primero una ruta con al menos dos puntos.",
```

- [ ] **Step 4: Añadir los estilos**

En `frontend/src/index.css`, sustituir la línea `.sidebar-export { width: 100%; }` por:

```css
/* Aktionen am unteren Ende der Seitenleiste: Speichern und GPX-Export */
.sidebar-actions { display: flex; gap: 6px; }
.sidebar-actions button { flex: 1; }
.sidebar-export { width: 100%; }

/* Namensfeld beim Speichern */
.save-form { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.save-form-row { display: flex; gap: 6px; }
.save-form-row button { flex: 1; }

/* Liste der gespeicherten Routen */
.saved-item { display: flex; flex-direction: column; gap: 2px; }
.saved-item-meta { font-size: 11px; color: var(--muted); }
.saved-item-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.saved-item-actions button { padding: 2px 6px; font-size: 12px; }
```

- [ ] **Step 5: Ampliar las props y el bloque de botones del Sidebar**

En `interface Props` de `frontend/src/components/Sidebar.tsx`, añadir junto a `onExportGpx`:

```ts
  // Gespeicherte Routen
  savedRoutes: SavedRouteSummary[];
  savedError: string | null;
  loadedRouteId: number | null;
  onSaveRoute: (name: string, asNew: boolean) => void;
  onLoadRoute: (id: number) => void;
  onRenameRoute: (id: number, name: string) => void;
  onDuplicateRoute: (id: number) => void;
  onDeleteRoute: (id: number) => void;
```

Ampliar el import de tipos con `SavedRouteSummary`, y añadir al inicio del componente:

```ts
  // Eingabe für den Namen beim Speichern; null = Formular zu.
  const [saveName, setSaveName] = useState<string | null>(null);
  const [saveAsNew, setSaveAsNew] = useState(false);
```

Sustituir el bloque del botón de GPX (líneas 489-496) por:

```tsx
      {/* Aktionen: Speichern und GPX-Export */}
      <div className="sidebar-actions">
        <button
          className="primary"
          onClick={() => {
            setSaveAsNew(false);
            setSaveName(p.suggestedName);
          }}
          disabled={p.waypoints.length < 2}
          title={p.waypoints.length < 2 ? t("saved.needRoute") : undefined}
        >
          {p.loadedRouteId === null ? t("saved.save") : t("saved.update")}
        </button>
        <button className="primary" onClick={p.onExportGpx} disabled={!p.route}>
          {t("sb.exportGpx")}
        </button>
      </div>

      {saveName !== null && (
        <div className="save-form">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={t("saved.namePlaceholder")}
            autoFocus
          />
          <div className="save-form-row">
            <button
              className="primary"
              disabled={saveName.trim() === ""}
              onClick={() => {
                p.onSaveRoute(saveName.trim(), saveAsNew);
                setSaveName(null);
              }}
            >
              {t("saved.confirm")}
            </button>
            <button className="ghost" onClick={() => setSaveName(null)}>
              {t("saved.cancel")}
            </button>
          </div>
          {p.loadedRouteId !== null && !saveAsNew && (
            <button
              className="ghost"
              onClick={() => {
                setSaveAsNew(true);
                setSaveName(p.suggestedName);
              }}
            >
              {t("saved.saveAsNew")}
            </button>
          )}
        </div>
      )}
    </aside>
```

Añadir también `suggestedName: string;` a `interface Props`.

- [ ] **Step 6: Conectar el estado en App.tsx**

En `frontend/src/App.tsx`, ampliar los imports:

```ts
import {
  createRoute, deleteRoute, getRoute, listRoutes, updateRoute,
} from "./api/client";
import { suggestRouteName } from "./routeName";
import type { SavedRouteSummary } from "./types";
```

Añadir estado junto al resto:

```ts
  // Gespeicherte Routen
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteSummary[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [loadedRouteId, setLoadedRouteId] = useState<number | null>(null);
```

Cargar la lista al montar y tras cada cambio:

```ts
  const refreshSaved = useCallback(async () => {
    try {
      setSavedRoutes(await listRoutes());
      setSavedError(null);
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
    }
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);
```

Las operaciones:

```ts
  const suggestedName = useMemo(
    () => suggestRouteName(waypoints.map((w) => w.label), roundTrip),
    [waypoints, roundTrip],
  );

  const saveRoute = async (name: string, asNew: boolean) => {
    const wps = waypoints.map((w) => ({
      lng: w.lng, lat: w.lat, label: w.label, profile: w.profile ?? defaultProfile,
    }));
    try {
      if (loadedRouteId !== null && !asNew) {
        await updateRoute(loadedRouteId, { name, roundTrip, waypoints: wps });
      } else {
        const created = await createRoute(name, roundTrip, wps);
        setLoadedRouteId(created.id);
      }
      await refreshSaved();
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
    }
  };

  const loadRoute = async (id: number) => {
    try {
      const route = await getRoute(id);
      setWaypoints(route.waypoints.map((w) => ({ id: newId(), ...w })));
      setRoundTrip(route.roundTrip);
      setLoadedRouteId(id);
      setSavedError(null);
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
      await refreshSaved();
    }
  };
```

Pasar todo al `Sidebar` en su JSX, junto a `onExportGpx`:

```tsx
        savedRoutes={savedRoutes}
        savedError={savedError}
        loadedRouteId={loadedRouteId}
        suggestedName={suggestedName}
        onSaveRoute={saveRoute}
        onLoadRoute={loadRoute}
        onRenameRoute={() => { /* Task 5 */ }}
        onDuplicateRoute={() => { /* Task 5 */ }}
        onDeleteRoute={() => { /* Task 5 */ }}
```

- [ ] **Step 7: Comprobar tipos y probar en el navegador**

Run: `npm run build --workspace frontend`
Expected: sin errores.

Arrancar con `npm run dev` (backend y frontend), poner dos puntos en el mapa, pulsar
guardar, aceptar el nombre propuesto, y comprobar con
`curl -s http://127.0.0.1:8080/api/routes` que la ruta está en la base de datos con ese
nombre y sus dos waypoints.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/i18n.tsx \
  frontend/src/index.css frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat: Routen aus der Seitenleiste speichern"
```

---

### Task 5: Lista de rutas guardadas con sus acciones

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: las props añadidas en la Task 4 y el cliente de la Task 4.
- Produces: la tarjeta plegable «Rutas guardadas» y las cuatro acciones cableadas.

- [ ] **Step 1: Añadir la tarjeta al Sidebar**

Junto a los otros estados locales del componente, añadir:

```ts
  const [savedOpen, setSavedOpen] = useState(false);
  // Kennung der Route, für die eine Löschbestätigung offen ist.
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // Kennung der Route, die gerade umbenannt wird, plus Eingabewert.
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
```

Insertar esta tarjeta justo antes del bloque `<div className="sidebar-actions">`:

```tsx
      {/* Gespeicherte Routen */}
      <div className="card">
        <button
          className="card-toggle"
          onClick={() => setSavedOpen((o) => !o)}
          aria-expanded={savedOpen}
        >
          <span className="card-toggle-caret">{savedOpen ? "▾" : "▸"}</span>
          <span className="card-toggle-title">{t("saved.title")}</span>
          <span className="card-toggle-meta">
            {p.savedRoutes.length > 0 ? p.savedRoutes.length : ""}
          </span>
        </button>
        {savedOpen && (
          <div className="card-body">
            {p.savedError && <p className="muted">{p.savedError}</p>}
            {p.savedRoutes.length === 0 && !p.savedError ? (
              <p className="muted">{t("saved.empty")}</p>
            ) : (
              <ul className="list">
                {p.savedRoutes.map((r) => (
                  <li key={r.id} className="saved-item">
                    <strong>{r.name}</strong>
                    <span className="saved-item-meta">
                      {t("saved.points", { n: r.pointCount })} ·{" "}
                      {t("saved.updatedAt", {
                        date: new Date(r.updatedAt).toLocaleString(lang),
                      })}
                    </span>
                    {renaming?.id === r.id ? (
                      <div className="save-form">
                        <input
                          value={renaming.name}
                          onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                          autoFocus
                        />
                        <div className="save-form-row">
                          <button
                            className="primary"
                            disabled={renaming.name.trim() === ""}
                            onClick={() => {
                              p.onRenameRoute(r.id, renaming.name.trim());
                              setRenaming(null);
                            }}
                          >
                            {t("saved.confirm")}
                          </button>
                          <button className="ghost" onClick={() => setRenaming(null)}>
                            {t("saved.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : confirmRemove === r.id ? (
                      <div className="saved-item-actions">
                        <button
                          className="primary"
                          onClick={() => {
                            p.onDeleteRoute(r.id);
                            setConfirmRemove(null);
                          }}
                        >
                          {t("saved.confirmRemove")}
                        </button>
                        <button className="ghost" onClick={() => setConfirmRemove(null)}>
                          {t("saved.cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="saved-item-actions">
                        <button onClick={() => p.onLoadRoute(r.id)}>{t("saved.load")}</button>
                        <button
                          className="ghost"
                          onClick={() => setRenaming({ id: r.id, name: r.name })}
                        >
                          {t("saved.rename")}
                        </button>
                        <button className="ghost" onClick={() => p.onDuplicateRoute(r.id)}>
                          {t("saved.duplicate")}
                        </button>
                        <button className="ghost" onClick={() => setConfirmRemove(r.id)}>
                          {t("saved.remove")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
```

`lang` ya está disponible en el componente: viene de `useI18n()`.

- [ ] **Step 2: Cablear las tres acciones que faltan en App.tsx**

Sustituir los tres marcadores de la Task 4 por implementaciones reales:

```ts
  const renameRoute = async (id: number, name: string) => {
    try {
      await updateRoute(id, { name });
      await refreshSaved();
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
    }
  };

  const duplicateRoute = async (id: number) => {
    try {
      const route = await getRoute(id);
      // Duplizieren braucht keinen eigenen Endpunkt: lesen und neu anlegen.
      await createRoute(
        `${route.name} ${t("saved.copySuffix")}`.slice(0, 120),
        route.roundTrip,
        route.waypoints,
      );
      await refreshSaved();
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
    }
  };

  const removeRoute = async (id: number) => {
    try {
      await deleteRoute(id);
      // Die geladene Route ist weg: der Speichern-Knopf legt wieder neu an.
      if (loadedRouteId === id) setLoadedRouteId(null);
      await refreshSaved();
    } catch (e: any) {
      setSavedError(e.message ?? String(e));
    }
  };
```

Y en el JSX del `Sidebar`:

```tsx
        onRenameRoute={renameRoute}
        onDuplicateRoute={duplicateRoute}
        onDeleteRoute={removeRoute}
```

- [ ] **Step 3: Comprobar tipos**

Run: `npm run build --workspace frontend`
Expected: sin errores.

- [ ] **Step 4: Probar el ciclo completo en el navegador**

Con `npm run dev`, y partiendo de una ruta de dos puntos:

1. Guardar con el nombre propuesto; la tarjeta muestra una entrada con su fecha.
2. Pulsar cargar en otra pestaña del navegador: aparecen los waypoints y la ruta se
   recalcula sola.
3. Mover un waypoint y pulsar el botón, que ahora dice actualizar: la fecha cambia y **no**
   aparece una segunda entrada.
4. Duplicar: aparece una entrada con el sufijo de copia.
5. Renombrar la copia y comprobar que la lista se reordena por fecha de modificación.
6. Borrar la copia: pide confirmación y desaparece.
7. Cambiar el idioma con el selector y comprobar que los textos nuevos están traducidos.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat: Liste gespeicherter Routen mit Laden, Umbenennen, Duplizieren, Löschen"
```

---

### Task 6: Volumen persistente, despliegue y documentación

**Files:**
- Modify: `docker-compose.server.yml`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `config/config.yaml`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `ROUTES_DB_PATH` del backend.
- Produces: el volumen del contenedor y la documentación.

- [ ] **Step 1: Montar el volumen**

En el servicio `motorrad-routenplaner-backend` de `docker-compose.server.yml`, añadir a
`environment`:

```yaml
      ROUTES_DB_PATH: "/data/routes.db"
```

y añadir al servicio:

```yaml
    volumes:
      # Gespeicherte Routen müssen Neubauten des Containers überleben.
      - ./data/routes:/data
```

- [ ] **Step 2: Documentar la variable**

Añadir a `.env.example`:

```bash
# Fichero de la base de datos de rutas guardadas, dentro del contenedor.
ROUTES_DB_PATH=/data/routes.db
```

Añadir `data/` a `.gitignore`.

- [ ] **Step 3: Crear el directorio con los permisos correctos y desplegar**

El backend corre como usuario sin privilegios, así que el directorio del anfitrión debe
pertenecer a ese usuario. Este es el punto más probable de fallo.

```bash
ssh server_ia 'cd /home/chispas/herramientas/motorrad-routenplaner
  git fetch origin -q && git reset --hard origin/main -q
  mkdir -p data/routes
  # node:22-slim usa uid/gid 1000 para el Benutzer "node".
  sudo chown -R 1000:1000 data/routes || chown -R 1000:1000 data/routes
  docker compose -f docker-compose.server.yml up -d --build motorrad-routenplaner-backend
  sleep 25
  docker compose -f docker-compose.server.yml ps'
```

Expected: el contenedor del backend llega a `healthy`.

- [ ] **Step 4: Verificar la persistencia real**

```bash
ssh server_ia '
B=http://192.168.65.9:9640
curl -s -X POST $B/api/routes -H "Content-Type: application/json" \
  -d "{\"name\":\"Persistencia\",\"roundTrip\":false,\"waypoints\":[
      {\"lng\":-2.935,\"lat\":43.263,\"label\":\"Bilbao\",\"profile\":\"curvy\"},
      {\"lng\":-2.679,\"lat\":43.316,\"label\":\"Gernika\",\"profile\":\"fast\"}]}"
echo "--- reiniciando el contenedor:"
cd /home/chispas/herramientas/motorrad-routenplaner
docker compose -f docker-compose.server.yml restart motorrad-routenplaner-backend
sleep 20
echo "--- la ruta sigue ahí:"
curl -s $B/api/routes
echo "--- el fichero existe en el anfitrión:"
ls -la data/routes/'
```

Expected: tras reiniciar, la ruta sigue en la lista, y `routes.db` existe en el anfitrión.

- [ ] **Step 5: Documentar**

En `config/config.yaml`, añadir un bloque:

```yaml
saved_routes:
  # Rutas guardadas por la interfaz web. No las escribe el servidor MCP.
  engine: node:sqlite
  db_path_container: /data/routes.db
  volume_host: ./data/routes
  notes:
    - node:sqlite es API experimental; esta encapsulada en backend/src/services/routeStore.ts.
    - El directorio del anfitrion debe pertenecer al uid 1000, porque el backend no corre como root.
    - Si la base de datos no se puede abrir, /api/routes responde 503 y el resto sigue funcionando.
```

En `CLAUDE.md`, añadir al apartado de comandos que `npm test` cubre ya tres workspaces, y
una sección corta sobre el almacén: que `routeStore.ts` es el único módulo que conoce
SQLite, que las fechas son ISO en UTC con `created_at` inmutable, que los waypoints van
como JSON en una columna porque la ruta siempre se lee completa, y que un fallo al abrir la
base de datos degrada solo `/api/routes`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.server.yml .env.example .gitignore config/config.yaml CLAUDE.md
git commit -m "feat: Volume und Dokumentation für gespeicherte Routen"
```

---

## Self-review

**Cobertura de la spec.** Esquema y motor, Task 1. API y validación, Tasks 1 y 2.
Degradación a 503, Task 2 Step 4, que la verifica explícitamente. Nombre propuesto, Task 3.
Botón junto al de GPX y campo en línea, Task 4. Lista con las cuatro acciones y
confirmación de borrado, Task 5. Volumen persistente y permisos, Task 6. Pruebas de que
`updated_at` cambia y `created_at` no, Task 1. Duplicar sin endpoint propio, Task 5 Step 2.

**Sin placeholders.** Los tres `/* Task 5 */` de la Task 4 Step 6 son marcadores
deliberados y temporales que la Task 5 Step 2 sustituye por código real; están señalados en
ambos sitios.

**Consistencia de nombres.** `createRouteStore`, `RouteStore`, `RouteStoreError`,
`StoredWaypoint`, `StoredRouteSummary`, `StoredRoute`, `suggestRouteName`, `listRoutes`,
`getRoute`, `createRoute`, `updateRoute`, `deleteRoute`, `savedRoutes`, `loadedRouteId`,
`suggestedName`, `onSaveRoute`, `onLoadRoute`, `onRenameRoute`, `onDuplicateRoute`,
`onDeleteRoute` se usan con la misma firma en todas las tareas donde aparecen. Los tipos del
backend (`Stored*`) y del frontend (`Saved*`) son deliberadamente distintos: no hay
importación entre workspaces, y su equivalencia se comprueba al consumir los endpoints.

**Riesgo con vigilancia.** `node:sqlite` devuelve filas sin prototipo, por eso `toRoute`
construye objetos propios en lugar de devolver la fila. `lastInsertRowid` y `changes` pueden
ser `bigint`, de ahí los `Number(...)`.
