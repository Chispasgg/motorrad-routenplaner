// Formt das Routing-Ergebnis in einen kurzen Text, den ein Agent direkt
// weitergeben kann. Absichtlich ohne Geometrie: die gehört in den Link.
import type { ProfileName, RouteResult } from "./types.js";

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return h > 0 ? `${h} h ${min} min` : `${min} min`;
}

export interface RouteSummaryInput {
  labels: string[];
  roundTrip: boolean;
  profiles: ProfileName[];
  route: RouteResult;
  webUrl: string;
}

export function formatRouteSummary(input: RouteSummaryInput): string {
  const { labels, roundTrip, profiles, route, webUrl } = input;
  const lines: string[] = [];

  lines.push(
    `Route: ${labels.join(" → ")}${roundTrip ? " → " + labels[0] + " (Rundtour)" : ""}`,
  );
  lines.push(
    `Gesamt: ${formatDistance(route.distanceM)}, ${formatDuration(route.durationS)}`,
  );

  const legs = route.legs ?? [];
  if (legs.length > 1) {
    lines.push("Abschnitte:");
    legs.forEach((leg, i) => {
      const from = labels[i] ?? `Punkt ${i + 1}`;
      const isReturn = roundTrip && i === legs.length - 1;
      const to = isReturn ? `${labels[0]} (zurück)` : (labels[i + 1] ?? `Punkt ${i + 2}`);
      const profile = profiles[i] ?? profiles[0];
      lines.push(
        `  ${i + 1}. ${from} → ${to} [${profile}]: ` +
          `${formatDistance(leg.distanceM)}, ${formatDuration(leg.durationS)}`,
      );
    });
  }

  const features = route.features ?? [];
  const tolls = features.filter((f) => f.kind === "toll");
  const ferries = features.filter((f) => f.kind === "ferry");
  if (tolls.length > 0) {
    lines.push(`Maut: ${tolls.length} Abschnitt(e), zusammen ${formatDistance(
      tolls.reduce((sum, f) => sum + f.lengthM, 0),
    )}`);
  }
  if (ferries.length > 0) {
    lines.push(`Fähre: ${ferries.length} Abschnitt(e), zusammen ${formatDistance(
      ferries.reduce((sum, f) => sum + f.lengthM, 0),
    )}`);
  }

  lines.push(`Auf der Karte öffnen: ${webUrl}`);
  return lines.join("\n");
}
