// Liest eine Route aus der Adresszeile: ?wp=lng,lat,profil,name;...[&rt=1]
// Der MCP-Server erzeugt diese Links. Ein fehlerhafter Link darf die App nie
// stoppen: ungültige Einträge werden übersprungen.
import type { ProfileName, Waypoint } from "./types";

const PROFILES: ProfileName[] = ["fast", "curvy", "autobahn"];
/** Schutz gegen absurd lange Links. */
const MAX_WAYPOINTS = 25;

export interface ParsedDeepLink {
  waypoints: Waypoint[];
  roundTrip: boolean;
}

export function parseDeepLink(
  search: string,
  makeId: () => string,
): ParsedDeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("wp");
  if (!raw) return null;

  const waypoints: Waypoint[] = [];
  for (const token of raw.split(";")) {
    if (waypoints.length >= MAX_WAYPOINTS) break;
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

    const profile = PROFILES.includes(parts[2] as ProfileName)
      ? (parts[2] as ProfileName)
      : "curvy";

    let label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (parts.length > 3 && parts[3] !== "") {
      try {
        label = decodeURIComponent(parts.slice(3).join(","));
      } catch {
        // Fehlerhafte Kodierung: bei den Koordinaten als Label bleiben.
      }
    }
    waypoints.push({ id: makeId(), lng, lat, label, profile });
  }

  if (waypoints.length < 2) return null;
  return { waypoints, roundTrip: params.get("rt") === "1" };
}
