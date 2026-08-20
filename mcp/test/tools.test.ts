import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePoints } from "../src/tools.js";
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
