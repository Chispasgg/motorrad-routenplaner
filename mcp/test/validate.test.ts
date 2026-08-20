import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlanRoute, segmentCount, ToolInputError } from "../src/validate.js";

test("zählt Abschnitte mit und ohne Rundtour", () => {
  assert.equal(segmentCount(2, false), 1);
  assert.equal(segmentCount(3, false), 2);
  assert.equal(segmentCount(3, true), 3);
});

test("setzt Standardwerte", () => {
  const v = validatePlanRoute({ points: ["Bilbao", "Jaca"] }, 10);
  assert.equal(v.profile, "curvy");
  assert.equal(v.roundTrip, false);
  assert.equal(v.avoidRoadworks, true);
  assert.deepEqual(v.include, []);
});

test("verlangt mindestens zwei Punkte", () => {
  assert.throws(() => validatePlanRoute({ points: ["Bilbao"] }, 10), ToolInputError);
});

test("nennt die Obergrenze im Fehlertext", () => {
  const points = Array.from({ length: 11 }, (_, i) => `Ort ${i}`);
  assert.throws(() => validatePlanRoute({ points }, 10), /10/);
});

test("lehnt ein unbekanntes Profil ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["a", "b"], profile: "sport" }, 10), /sport/);
});

test("prüft die Länge von profiles gegen die Abschnitte", () => {
  assert.throws(
    () => validatePlanRoute({ points: ["a", "b", "c"], profiles: ["curvy"] }, 10),
    /2/,
  );
  const ok = validatePlanRoute({ points: ["a", "b", "c"], profiles: ["curvy", "fast"] }, 10);
  assert.deepEqual(ok.profiles, ["curvy", "fast"]);
});

test("berücksichtigt die Rundtour bei der Länge von profiles", () => {
  const ok = validatePlanRoute(
    { points: ["a", "b"], roundTrip: true, profiles: ["curvy", "fast"] },
    10,
  );
  assert.deepEqual(ok.profiles, ["curvy", "fast"]);
});

test("lehnt einen unbekannten Extra-Wert ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["a", "b"], include: ["hotels"] }, 10), /hotels/);
});

test("lehnt leere Ortsangaben ab", () => {
  assert.throws(() => validatePlanRoute({ points: ["Bilbao", "  "] }, 10), ToolInputError);
});
