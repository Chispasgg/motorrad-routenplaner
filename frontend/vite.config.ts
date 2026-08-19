import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// App-Version aus der Root-package.json (eine Ebene über frontend/) als Single
// Source of Truth – wird beim Build in den Code eingesetzt (__APP_VERSION__).
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

// Startansicht der Karte (bevor Wegpunkte gesetzt sind). Über die Umgebung
// einstellbar, damit das Deployment nicht am Code hängt:
//   VITE_MAP_CENTER="lng,lat"   VITE_MAP_ZOOM="10"
const DEFAULT_MAP_CENTER: [number, number] = [-2.935, 43.263]; // Bilbao
const DEFAULT_MAP_ZOOM = 10;

function mapCenter(): [number, number] {
  const raw = process.env.VITE_MAP_CENTER;
  if (!raw) return DEFAULT_MAP_CENTER;
  const [lng, lat] = raw.split(",").map((v) => Number(v.trim()));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`VITE_MAP_CENTER ist ungültig: "${raw}" (erwartet "lng,lat")`);
  }
  return [lng, lat];
}

function mapZoom(): number {
  const raw = process.env.VITE_MAP_ZOOM;
  if (!raw) return DEFAULT_MAP_ZOOM;
  const z = Number(raw);
  if (!Number.isFinite(z) || z < 0 || z > 22) {
    throw new Error(`VITE_MAP_ZOOM ist ungültig: "${raw}" (erwartet 0–22)`);
  }
  return z;
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version ?? "0.0.0"),
    __MAP_CENTER__: JSON.stringify(mapCenter()),
    __MAP_ZOOM__: JSON.stringify(mapZoom()),
  },
  server: {
    port: 5173,
    proxy: {
      // Backend-Aufrufe im Dev-Betrieb an Fastify weiterleiten
      "/api": "http://localhost:8080",
    },
  },
});
