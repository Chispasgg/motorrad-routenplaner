// Prüft die Werkzeug-Argumente und liefert Meldungen, mit denen ein Agent
// seinen Aufruf korrigieren kann.
import type { ProfileName } from "./types.js";

export class ToolInputError extends Error {}

export type Extra = "pois" | "fuel" | "weather";

const PROFILES: ProfileName[] = ["fast", "curvy", "autobahn"];
const EXTRAS: Extra[] = ["pois", "fuel", "weather"];

export interface PlanRouteInput {
  points: string[];
  profile: ProfileName;
  profiles?: ProfileName[];
  roundTrip: boolean;
  avoidRoadworks: boolean;
  include: Extra[];
}

/** Bei einer Rundtour kommt der Rückweg zum Start als eigener Abschnitt hinzu. */
export function segmentCount(pointCount: number, roundTrip: boolean): number {
  return roundTrip ? pointCount : pointCount - 1;
}

function asProfile(value: unknown, field: string): ProfileName {
  if (typeof value !== "string" || !PROFILES.includes(value as ProfileName)) {
    throw new ToolInputError(
      `${field} ist ungültig: ${JSON.stringify(value)}. Erlaubt: ${PROFILES.join(", ")}.`,
    );
  }
  return value as ProfileName;
}

export function validatePlanRoute(raw: unknown, maxPoints: number): PlanRouteInput {
  const input = (raw ?? {}) as Record<string, unknown>;

  if (!Array.isArray(input.points)) {
    throw new ToolInputError("points fehlt: erwartet eine Liste aus Orten oder \"lng,lat\".");
  }
  if (input.points.length < 2) {
    throw new ToolInputError("points braucht mindestens zwei Einträge (Start und Ziel).");
  }
  if (input.points.length > maxPoints) {
    throw new ToolInputError(
      `points hat ${input.points.length} Einträge, erlaubt sind höchstens ${maxPoints}. ` +
        "Jeder Abschnitt kostet mehrere Routing-Aufrufe, darum die Grenze.",
    );
  }
  const points = input.points.map((p, i) => {
    if (typeof p !== "string" || p.trim() === "") {
      throw new ToolInputError(`points[${i}] ist leer oder kein Text.`);
    }
    return p.trim();
  });

  const roundTrip = input.roundTrip === true;
  const avoidRoadworks = input.avoidRoadworks !== false;
  const profile = input.profile === undefined ? "curvy" : asProfile(input.profile, "profile");

  let profiles: ProfileName[] | undefined;
  if (input.profiles !== undefined) {
    if (!Array.isArray(input.profiles)) {
      throw new ToolInputError("profiles muss eine Liste von Profilnamen sein.");
    }
    const expected = segmentCount(points.length, roundTrip);
    if (input.profiles.length !== expected) {
      throw new ToolInputError(
        `profiles hat ${input.profiles.length} Einträge, erwartet werden ${expected} ` +
          `(ein Profil je Abschnitt${roundTrip ? ", Rückweg eingeschlossen" : ""}).`,
      );
    }
    profiles = input.profiles.map((p, i) => asProfile(p, `profiles[${i}]`));
  }

  let include: Extra[] = [];
  if (input.include !== undefined) {
    if (!Array.isArray(input.include)) {
      throw new ToolInputError("include muss eine Liste sein.");
    }
    include = input.include.map((e) => {
      if (typeof e !== "string" || !EXTRAS.includes(e as Extra)) {
        throw new ToolInputError(
          `include enthält ${JSON.stringify(e)}. Erlaubt: ${EXTRAS.join(", ")}.`,
        );
      }
      return e as Extra;
    });
  }

  return { points, profile, profiles, roundTrip, avoidRoadworks, include };
}
