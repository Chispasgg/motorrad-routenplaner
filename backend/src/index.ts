// Fastify-Backend: orchestriert Routing (BRouter), POIs/Baustellen (Overpass +
// Autobahn-API), Geocoding (Nominatim) und GPX-Export.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { config, packaged } from "./config.js";
import { route as brouterRoute } from "./services/brouter.js";
import { findPois } from "./services/overpass.js";
import { getRoadworks, bboxOf } from "./services/roadworks.js";
import { geocode, reverseGeocode } from "./services/geocode.js";
import { weatherAlong } from "./services/weather.js";
import { getVersionInfo } from "./services/version.js";
import { buildGpx, type GpxWaypoint } from "./services/gpx.js";
import { staticAsset, devPublicDir } from "./resources.js";
import { liveBoard } from "./services/liveBoard.js";
import {
  createRouteStore,
  RouteStoreError,
  type RouteStore,
  type StoredWaypoint,
} from "./services/routeStore.js";
import type { LngLat, NoGo, ProfileName, RouteRequest } from "./types.js";

// In der gepackten EXE keinen Pino-Logger (vermeidet Worker-/Transport-Probleme).
const app = Fastify({ logger: !packaged });

app.get("/api/health", async () => ({ ok: true }));

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

// --- Routing ---------------------------------------------------------------
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
    // Die Labels kennt nur der Aufrufer: der MCP-Server hat sie aufgelöst.
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
      onLeg: live ? (leg) => liveBoard.publish({ type: "leg", ...leg }) : undefined,
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

// --- Geocoding -------------------------------------------------------------
app.get<{ Querystring: { q?: string } }>("/api/geocode", async (req, reply) => {
  const q = (req.query.q ?? "").trim();
  if (!q) return reply.code(400).send({ error: "Parameter q fehlt." });
  try {
    return await geocode(q);
  } catch (err: any) {
    return reply.code(502).send({ error: String(err.message ?? err) });
  }
});

// --- Reverse-Geocoding (aktueller Standort -> Adresse) --------------------
app.get<{ Querystring: { lat?: string; lng?: string } }>(
  "/api/reverse",
  async (req, reply) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ error: "Parameter lat/lng fehlen." });
    }
    try {
      return await reverseGeocode(lat, lng);
    } catch (err: any) {
      return reply.code(502).send({ error: String(err.message ?? err) });
    }
  },
);

// --- Baustellen ------------------------------------------------------------
app.post<{ Body: { points: LngLat[]; includeOsm?: boolean } }>(
  "/api/roadworks",
  async (req, reply) => {
    const { points, includeOsm = true } = req.body ?? { points: [] };
    if (!Array.isArray(points) || points.length < 2) {
      return reply.code(400).send({ error: "Mindestens zwei Punkte nötig." });
    }
    try {
      return await getRoadworks(bboxOf(points), includeOsm);
    } catch (err: any) {
      req.log.error(err);
      return reply.code(502).send({ error: String(err.message ?? err) });
    }
  },
);

// --- POIs (Restaurants/Imbisse) -------------------------------------------
app.post<{
  Body: { line: LngLat[]; bufferM?: number; category?: "food" | "fuel" | "all" };
}>(
  "/api/pois",
  async (req, reply) => {
    const { line, bufferM = 500, category = "food" } = req.body ?? { line: [] };
    if (!Array.isArray(line) || line.length < 2) {
      return reply.code(400).send({ error: "Routen-Geometrie fehlt." });
    }
    try {
      return await findPois(line, { bufferM, category });
    } catch (err: any) {
      req.log.error(err);
      return reply.code(502).send({ error: String(err.message ?? err) });
    }
  },
);

// --- Wetter entlang der Route ---------------------------------------------
app.post<{
  Body: { line: LngLat[]; date?: string; samples?: number };
}>("/api/weather", async (req, reply) => {
  const { line, date, samples = 5 } = req.body ?? { line: [] };
  if (!Array.isArray(line) || line.length < 2) {
    return reply.code(400).send({ error: "Routen-Geometrie fehlt." });
  }
  try {
    return await weatherAlong(line, date, Math.min(Math.max(samples, 2), 10));
  } catch (err: any) {
    req.log.error(err);
    return reply.code(502).send({ error: String(err.message ?? err) });
  }
});

// --- Versions-Check (neueres GitHub-Release?) ------------------------------
app.get<{ Querystring: { current?: string } }>("/api/version", async (req) => {
  const current = (req.query.current ?? "0.0.0").trim() || "0.0.0";
  return getVersionInfo(current);
});

// --- GPX-Export ------------------------------------------------------------
app.post<{ Body: { track: LngLat[]; waypoints?: GpxWaypoint[]; name?: string } }>(
  "/api/gpx",
  async (req, reply) => {
    const { track, waypoints = [], name } = req.body ?? { track: [] };
    if (!Array.isArray(track) || track.length < 2) {
      return reply.code(400).send({ error: "Track fehlt." });
    }
    const gpx = buildGpx(track, waypoints, name);
    reply
      .header("Content-Type", "application/gpx+xml")
      .header("Content-Disposition", `attachment; filename="route.gpx"`)
      .send(gpx);
  },
);

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

// --- Gespeicherte Routen ----------------------------------------------------
/** Meldung, wenn der Speicher nicht zur Verfügung steht. */
function unavailable() {
  return {
    error: `Der Routen-Speicher ist nicht verfügbar: ${routeStoreError ?? "unbekannt"}`,
  };
}

/** Kennung aus dem Pfad lesen; null, wenn sie keine ganze Zahl ist. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

app.get("/api/routes", async (_req, reply) => {
  if (!routeStore) return reply.code(503).send(unavailable());
  return routeStore.list();
});

app.get<{ Params: { id: string } }>("/api/routes/:id", async (req, reply) => {
  if (!routeStore) return reply.code(503).send(unavailable());
  const id = parseId(req.params.id);
  if (id === null) return reply.code(400).send({ error: "Ungültige Kennung." });
  const route = routeStore.get(id);
  if (!route) return reply.code(404).send({ error: "Route nicht gefunden." });
  return route;
});

app.post<{ Body: { name?: string; roundTrip?: boolean; waypoints?: StoredWaypoint[] } }>(
  "/api/routes",
  async (req, reply) => {
    if (!routeStore) return reply.code(503).send(unavailable());
    const { name, roundTrip = false, waypoints } = req.body ?? {};
    try {
      return routeStore.create({
        name: name as string,
        roundTrip,
        waypoints: waypoints ?? [],
      });
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
  if (!routeStore) return reply.code(503).send(unavailable());
  const id = parseId(req.params.id);
  if (id === null) return reply.code(400).send({ error: "Ungültige Kennung." });
  try {
    const updated = routeStore.update(id, req.body ?? {});
    if (!updated) return reply.code(404).send({ error: "Route nicht gefunden." });
    return updated;
  } catch (err) {
    if (err instanceof RouteStoreError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.delete<{ Params: { id: string } }>("/api/routes/:id", async (req, reply) => {
  if (!routeStore) return reply.code(503).send(unavailable());
  const id = parseId(req.params.id);
  if (id === null) return reply.code(400).send({ error: "Ungültige Kennung." });
  if (!routeStore.remove(id)) return reply.code(404).send({ error: "Route nicht gefunden." });
  return { ok: true };
});

// --- Statisches Frontend ausliefern ---------------------------------------
// In der EXE aus eingebetteten Assets, im Dev-Betrieb optional aus frontend/dist.
const serveStatic = packaged || existsSync(devPublicDir);
if (serveStatic) {
  const mime: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    ico: "image/x-icon",
    map: "application/json",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    txt: "text/plain; charset=utf-8",
  };
  const contentType = (p: string) => mime[p.split(".").pop() ?? ""] ?? "application/octet-stream";

  app.get("/*", async (req, reply) => {
    let p = (req.url.split("?")[0] || "/").slice(1);
    if (p === "") p = "index.html";
    let buf = packaged ? staticAsset(p) : null;
    if (!buf && !packaged) {
      const f = join(devPublicDir, p);
      if (existsSync(f)) buf = await readFile(f);
    }
    // SPA-Fallback: unbekannte Pfade liefern index.html
    if (!buf) {
      buf = packaged
        ? staticAsset("index.html")
        : await readFile(join(devPublicDir, "index.html")).catch(() => null);
      p = "index.html";
    }
    if (!buf) return reply.code(404).send("Not found");
    return reply.header("Content-Type", contentType(p)).send(buf);
  });
}

// --- Start mit Port-Fallback + Browser öffnen -----------------------------
async function start() {
  await app.register(cors, { origin: true });
  const candidates = [config.port, 8081, 8082, 8090, 3000];
  for (const port of candidates) {
    try {
      await app.listen({ port, host: config.host });
      const url = `http://localhost:${port}`;
      if (packaged) {
        console.log(`\n  🏍️  Motorrad-Routenplaner läuft: ${url}\n  (zum Beenden dieses Fenster schließen)\n`);
        openBrowser(url);
      } else {
        app.log.info(`Backend läuft auf ${url}`);
      }
      return;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") continue;
      console.error(err);
      process.exit(1);
    }
  }
  console.error("Kein freier Port gefunden.");
  process.exit(1);
}

function openBrowser(url: string) {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => { /* Browser-Start ist best effort */ });
}

start();
