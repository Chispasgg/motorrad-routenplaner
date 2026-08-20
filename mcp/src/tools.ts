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

/** Stützpunkte für die Wettervorhersage entlang der Route. */
const WEATHER_SAMPLES = 5;
/** Suchradius um die Route für Einkehr und Tankstellen, in Metern. */
const POI_BUFFER_M = 500;
/** Wie viele Treffer je Zusatzinfo aufgelistet werden. */
const POI_LIST_LIMIT = 10;
/** Wie viele Geocoding-Kandidaten geocode_place zurückgibt. */
const GEOCODE_LIMIT = 5;

async function describeExtra(
  api: BackendClient,
  extra: "pois" | "fuel" | "weather",
  line: LngLat[],
): Promise<string> {
  try {
    if (extra === "weather") {
      const res = await api.weather(line, undefined, WEATHER_SAMPLES);
      const rows = res.points.map(
        (p) => `  bei ${formatDistance(p.atM)}: ${p.tempMin}–${p.tempMax} °C, ` +
          `${p.precipMm ?? 0} mm, Wind ${p.windMaxKmh ?? 0} km/h`,
      );
      return [`Wetter (${res.date}):`, ...rows].join("\n");
    }
    // "pois" heißt in der Backend-API "food" (Restaurants, Imbisse, Cafés).
    const category = extra === "fuel" ? "fuel" : "food";
    const found = await api.pois(line, category, POI_BUFFER_M);
    const title = extra === "fuel" ? "Tankstellen" : "Einkehr";
    if (found.length === 0) return `${title}: keine im ${POI_BUFFER_M}-m-Umfeld gefunden.`;
    const rows = found
      .slice(0, POI_LIST_LIMIT)
      .map((p) => `  ${p.name}${p.brand ? ` (${p.brand})` : ""}, ${Math.round(p.distance)} m`);
    return [`${title} (${found.length} gefunden, die ersten ${rows.length}):`, ...rows].join("\n");
  } catch (err) {
    const why = err instanceof BackendError ? err.message : String(err);
    return `Zusatzinfo "${extra}" nicht verfügbar: ${why}`;
  }
}

/**
 * Die eigentliche Arbeit von plan_route, getrennt von der Werkzeug-Registrierung,
 * damit Profilzuordnung, Rundtour und Zusatzinfos testbar bleiben.
 */
export async function planRoute(
  api: BackendClient,
  raw: unknown,
  publicWebUrl: string,
  maxPoints: number,
): Promise<string> {
  const input = validatePlanRoute(raw, maxPoints);
  const resolved = await resolvePoints(api, input.points);

  const coords = resolved.map((r) => r.coord);
  const routingPoints: LngLat[] = input.roundTrip ? [...coords, coords[0]] : coords;
  const segments = segmentCount(coords.length, input.roundTrip);
  const profiles: ProfileName[] = input.profiles ?? new Array(segments).fill(input.profile);

  let nogos: NoGo[] = [];
  let roadworksFailed = false;
  if (input.avoidRoadworks) {
    try {
      const works = await api.roadworks(coords, true);
      nogos = works.map((w) => ({ lng: w.lng, lat: w.lat, radius: w.radius }));
    } catch {
      // Eine Route ohne Baustellenumfahrung ist besser als keine Route – der
      // Agent muss aber erfahren, dass das Meiden diesmal nicht stattfand.
      roadworksFailed = true;
    }
  }

  // Live an die Weboberfläche übertragen und die Alternativen weglassen: sie
  // kosten zwei Drittel der Zeit und ändern das Gezeichnete nicht.
  const route = await api.route(routingPoints, profiles, nogos, {
    live: { labels: resolved.map((r) => r.label) },
    alternatives: false,
  });

  const waypoints: DeepLinkWaypoint[] = resolved.map((r, i) => ({
    lng: r.coord[0],
    lat: r.coord[1],
    // Profil des Abschnitts, der von diesem Wegpunkt ausgeht. Der letzte Wegpunkt
    // ohne Rundtour ist das Ziel: dort beginnt kein Abschnitt mehr.
    profile: profiles[i] ?? profiles[profiles.length - 1],
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

  if (roadworksFailed) {
    parts.push(
      "Hinweis: Die Baustellen konnten nicht abgerufen werden, diese Route meidet " +
        "also keine. Ein erneuter Versuch kann helfen.",
    );
  }

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

  return parts.join("\n\n");
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
        const hits = (await api.geocode(query)).slice(0, GEOCODE_LIMIT);
        if (hits.length === 0) {
          return { content: [{ type: "text" as const, text: `Kein Treffer für "${query}".` }] };
        }
        const text = hits.map((h) => `${h.label} → ${h.lng},${h.lat}`).join("\n");
        return { content: [{ type: "text" as const, text }] };
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
        const text = await planRoute(api, raw, publicWebUrl, maxPoints);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
