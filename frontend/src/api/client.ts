// Dünner Client für das Backend (alle Aufrufe gehen über den Vite-Proxy /api).
import type {
  GeocodeResult,
  LngLat,
  NoGo,
  Poi,
  ProfileName,
  Roadwork,
  RouteResult,
  SavedRoute,
  SavedRouteSummary,
  SavedWaypoint,
  VersionInfo,
  WeatherResult,
} from "../types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Fehler ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchRoute(
  points: LngLat[],
  profiles: ProfileName[],
  nogos: NoGo[],
): Promise<RouteResult> {
  return post<RouteResult>("/api/route", { points, profiles, nogos });
}

export function fetchRoadworks(
  points: LngLat[],
  includeOsm: boolean,
): Promise<Roadwork[]> {
  return post<Roadwork[]>("/api/roadworks", { points, includeOsm });
}

export function fetchPois(
  line: LngLat[],
  category: "food" | "fuel" = "food",
  bufferM = 500,
): Promise<Poi[]> {
  return post<Poi[]>("/api/pois", { line, category, bufferM });
}

/** Wetter entlang der Route (Tageswerte) für ein Datum (YYYY-MM-DD, leer = heute). */
export function fetchWeather(
  line: LngLat[],
  date?: string,
  samples = 5,
): Promise<WeatherResult> {
  return post<WeatherResult>("/api/weather", { line, date, samples });
}

/** Versions-Check gegen das neueste GitHub-Release. */
export async function fetchVersion(current: string): Promise<VersionInfo> {
  const res = await fetch(`/api/version?current=${encodeURIComponent(current)}`);
  if (!res.ok) throw new Error("Versions-Check fehlgeschlagen");
  return res.json();
}

export async function geocode(q: string): Promise<GeocodeResult[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Adresssuche fehlgeschlagen");
  return res.json();
}

/** Koordinate -> Adresse (für „aktueller Standort"). */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeResult | null> {
  const res = await fetch(`/api/reverse?lat=${lat}&lng=${lng}`);
  if (!res.ok) return null;
  return res.json();
}

/** GPX herunterladen (Track + Wegpunkte). */
export async function downloadGpx(
  track: LngLat[],
  waypoints: { lng: number; lat: number; name: string }[],
  name = "Motorrad-Route",
): Promise<void> {
  const res = await fetch("/api/gpx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, waypoints, name }),
  });
  if (!res.ok) throw new Error("GPX-Export fehlgeschlagen");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "route.gpx";
  a.click();
  URL.revokeObjectURL(url);
}

// --- Gespeicherte Routen ---------------------------------------------------

/** Fehlertext aus einer Antwort ziehen, sonst den Statuscode nennen. */
async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
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

export function createRoute(
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
