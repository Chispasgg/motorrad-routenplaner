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
    const row = db
      .prepare("SELECT * FROM routes WHERE id = ?")
      .get(id) as unknown as Row | undefined;
    return row ?? null;
  }

  return {
    list() {
      const rows = db
        .prepare("SELECT * FROM routes ORDER BY updated_at DESC")
        .all() as unknown as Row[];
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
