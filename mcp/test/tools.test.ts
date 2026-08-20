import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoute, resolvePoints } from "../src/tools.js";
import { ToolInputError } from "../src/validate.js";
import type { BackendClient } from "../src/backend.js";

function fakeApi(
  geocodeResults: Record<string, { label: string; lat: number; lng: number }[]>,
): BackendClient {
  return {
    geocode: async (q) => geocodeResults[q] ?? [],
    route: async () => { throw new Error("nicht benutzt"); },
    roadworks: async () => [],
    pois: async () => [],
    weather: async () => ({ date: "", points: [] }),
  };
}

test("übernimmt Koordinaten unverändert", async () => {
  const out = await resolvePoints(fakeApi({}), ["-2.935,43.263", "1.5,42.0"]);
  assert.deepEqual(out[0].coord, [-2.935, 43.263]);
  assert.equal(out[0].label, "-2.935,43.263");
  assert.deepEqual(out[1].coord, [1.5, 42]);
});

test("löst Ortsnamen über Geocoding auf", async () => {
  const api = fakeApi({ Bilbao: [{ label: "Bilbao, Bizkaia", lat: 43.263, lng: -2.935 }] });
  const out = await resolvePoints(api, ["Bilbao"]);
  assert.deepEqual(out[0].coord, [-2.935, 43.263]);
  assert.equal(out[0].label, "Bilbao, Bizkaia");
});

test("nennt den Ort, der nicht gefunden wurde", async () => {
  const api = fakeApi({});
  await assert.rejects(
    () => resolvePoints(api, ["Kein Ort XYZ"]),
    (err: unknown) => err instanceof ToolInputError && /Kein Ort XYZ/.test((err as Error).message),
  );
});

test("lehnt Koordinaten außerhalb des gültigen Bereichs ab", async () => {
  await assert.rejects(
    () => resolvePoints(fakeApi({}), ["200,100"]),
    (err: unknown) => err instanceof ToolInputError,
  );
});

/** Fake-Backend mit steuerbarer Route und Baustellen-Abfrage. */
function routingApi(opts: {
  roadworksFails?: boolean;
  capture?: { points?: unknown; profiles?: unknown };
}): BackendClient {
  return {
    geocode: async (q) => [{ label: q, lat: 1, lng: 2 }],
    route: async (points, profiles) => {
      if (opts.capture) {
        opts.capture.points = points;
        opts.capture.profiles = profiles;
      }
      return {
        geojson: {
          features: [{ geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }],
        },
        distanceM: 1000,
        durationS: 600,
        legs: [{ distanceM: 1000, durationS: 600 }],
        features: [],
      };
    },
    roadworks: async () => {
      if (opts.roadworksFails) throw new Error("Overpass kaputt");
      return [];
    },
    pois: async () => [],
    weather: async () => ({ date: "2026-08-20", points: [] }),
  };
}

test("weist den Agenten darauf hin, wenn Baustellen nicht abrufbar sind", async () => {
  const text = await planRoute(
    routingApi({ roadworksFails: true }),
    { points: ["A", "B"] },
    "http://web",
    10,
  );
  assert.match(text, /Baustellen konnten nicht abgerufen werden/);
});

test("schweigt über Baustellen, wenn der Abruf klappt", async () => {
  const text = await planRoute(routingApi({}), { points: ["A", "B"] }, "http://web", 10);
  assert.doesNotMatch(text, /konnten nicht abgerufen/);
});

test("hängt bei einer Rundtour den Startpunkt an die Routing-Punkte an", async () => {
  const capture: { points?: unknown; profiles?: unknown } = {};
  await planRoute(
    routingApi({ capture }),
    { points: ["A", "B"], roundTrip: true },
    "http://web",
    10,
  );
  // Zwei Wegpunkte, aber drei Routing-Punkte und zwei Abschnitte.
  assert.equal((capture.points as unknown[]).length, 3);
  assert.equal((capture.profiles as unknown[]).length, 2);
});

test("erzeugt ohne Rundtour genau einen Abschnitt je Lücke", async () => {
  const capture: { points?: unknown; profiles?: unknown } = {};
  await planRoute(routingApi({ capture }), { points: ["A", "B", "C"] }, "http://web", 10);
  assert.equal((capture.points as unknown[]).length, 3);
  assert.equal((capture.profiles as unknown[]).length, 2);
});

test("setzt im Link je Wegpunkt das Profil des ausgehenden Abschnitts", async () => {
  const text = await planRoute(
    routingApi({}),
    { points: ["A", "B", "C"], profiles: ["curvy", "autobahn"] },
    "http://web",
    10,
  );
  // Wegpunkt A -> curvy, B -> autobahn, C (Ziel) erbt das letzte Profil.
  assert.match(text, /wp=2,1,curvy,A;2,1,autobahn,B;2,1,autobahn,C/);
});
