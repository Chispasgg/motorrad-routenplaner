// Baut den Link, mit dem die Weboberfläche eine Route direkt öffnet.
// Format: ?wp=lng,lat,profil,name;lng,lat,profil,name[&rt=1]
import type { ProfileName } from "./types.js";

export interface DeepLinkWaypoint {
  lng: number;
  lat: number;
  profile: ProfileName;
  name?: string;
}

/** Sechs Dezimalstellen entsprechen etwa 11 cm – genauer muss der Link nicht sein. */
function coord(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function buildDeepLink(
  baseUrl: string,
  waypoints: DeepLinkWaypoint[],
  roundTrip: boolean,
): string {
  if (waypoints.length < 2) {
    throw new Error("Für einen Link sind mindestens zwei Wegpunkte nötig.");
  }
  const tokens = waypoints.map((w) => {
    const base = `${coord(w.lng)},${coord(w.lat)},${w.profile}`;
    // encodeURIComponent maskiert auch , und ; – die Trennzeichen bleiben eindeutig.
    return w.name ? `${base},${encodeURIComponent(w.name)}` : base;
  });
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/?wp=${tokens.join(";")}${roundTrip ? "&rt=1" : ""}`;
}
