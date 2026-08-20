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

function intInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
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
