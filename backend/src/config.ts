// Zentrale Konfiguration, aus Umgebungsvariablen gelesen.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isSea } from "node:sea";

// Läuft die App als gepackte Single-EXE (Node SEA)?
export const packaged = (() => {
  try {
    return isSea();
  } catch {
    return false;
  }
})();

// __dirname-Ersatz für den Dev-Betrieb (in der EXE ungenutzt).
const here = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  // Bind-Adresse. Lokal/EXE bewusst nur 127.0.0.1; im Container muss 0.0.0.0
  // gesetzt werden, damit der Reverse-Proxy das Backend erreicht.
  host: process.env.HOST ?? "127.0.0.1",
  // In der EXE standardmäßig die öffentliche BRouter-Instanz (kein Docker nötig).
  brouterUrl:
    process.env.BROUTER_URL ??
    (packaged ? "https://brouter.de/brouter" : "http://localhost:17777/brouter"),
  // Sollen die .brf-Profile zum BRouter hochgeladen werden?
  // Die öffentliche Instanz kennt unsere Motorrad-Profile nicht -> Upload nötig.
  // Der eigene Container bringt sie schon mit (/app/profiles2) und wird direkt
  // per Profilnamen angesprochen; sein /profile-Endpunkt ist zudem defekt.
  brouterUploadProfiles: (process.env.BROUTER_UPLOAD_PROFILES ?? "true") !== "false",
  overpassUrl: process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",
  // Mehrere Overpass-Instanzen als Fallback: schlägt eine fehl/ist nicht erreichbar,
  // wird die nächste versucht. Eine per OVERPASS_URL gesetzte kommt zuerst.
  overpassUrls: (() => {
    const defaults = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ];
    const custom = process.env.OVERPASS_URL;
    if (!custom) return defaults;
    // Eigene URL nach vorne, Duplikate raus.
    return [custom, ...defaults.filter((u) => u !== custom)];
  })(),
  nominatimUrl: process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  autobahnUrl: process.env.AUTOBAHN_URL ?? "https://verkehr.autobahn.de/o/autobahn",
  // GitHub-Repository (für Versions-Check und Repo-Link in der Kopfzeile).
  githubRepo: process.env.GITHUB_REPO ?? "mzluzifer/motorrad-routenplaner",
  contactEmail: process.env.CONTACT_EMAIL ?? "",
  // Verzeichnis mit den BRouter-Profildateien (.brf) – nur im Dev-Betrieb.
  profilesDir: resolve(here, "..", "brouter-profiles"),
};

// User-Agent für faire Nutzung der OSM-Dienste (Nominatim verlangt einen aussagekräftigen UA).
// Achtung: Nominatim blockt User-Agents, die den Platzhalter "example.com" enthalten –
// daher die Kontaktangabe nur übernehmen, wenn sie echt gesetzt wurde.
const contactIsReal =
  config.contactEmail && !config.contactEmail.includes("example.com");
export const userAgent = contactIsReal
  ? `MotorradRoutenplaner/0.1 (${config.contactEmail})`
  : "MotorradRoutenplaner/0.1";
