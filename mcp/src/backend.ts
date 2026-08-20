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
  route(
    points: LngLat[],
    profiles: ProfileName[],
    nogos: NoGo[],
    opts?: { live?: { labels: string[] }; alternatives?: boolean },
  ): Promise<RouteResult>;
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
      } catch {
        // Kein JSON. Ein vorgeschalteter Proxy antwortet im Fehlerfall mit einer
        // HTML-Seite; rohes HTML hilft einem Agenten nicht weiter.
        if (/^\s*<(!doctype|html)/i.test(text)) {
          message =
            `Der Dienst vor dem Backend hat mit HTTP ${res.status} geantwortet ` +
            "(HTML-Fehlerseite, kein JSON). Bei langen Routen ist das meist ein " +
            "Zeitlimit des Reverse-Proxy.";
        }
      }
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
    route: (points, profiles, nogos, opts) =>
      post<RouteResult>("/api/route", {
        points,
        profiles,
        nogos,
        ...(opts?.live ? { live: opts.live } : {}),
        ...(opts?.alternatives === false ? { alternatives: false } : {}),
      }),
    roadworks: (points, includeOsm) => post<Roadwork[]>("/api/roadworks", { points, includeOsm }),
    pois: (line, category, bufferM) => post<Poi[]>("/api/pois", { line, category, bufferM }),
    weather: (line, date, samples) => post<WeatherResult>("/api/weather", { line, date, samples }),
  };
}

export const backend = createBackendClient(config.backendUrl, config.routeTimeoutMs);
