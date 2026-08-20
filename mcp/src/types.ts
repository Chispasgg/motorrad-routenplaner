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
