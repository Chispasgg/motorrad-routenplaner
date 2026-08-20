import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeepLink } from "../src/deeplink.js";

let counter = 0;
const makeId = () => `id-${counter++}`;

test("liest zwei Wegpunkte mit Namen", () => {
  const out = parseDeepLink("?wp=-2.935,43.263,curvy,Bilbao;-0.549,42.571,fast,Jaca", makeId);
  assert.ok(out);
  assert.equal(out.waypoints.length, 2);
  assert.equal(out.waypoints[0].label, "Bilbao");
  assert.equal(out.waypoints[0].lng, -2.935);
  assert.equal(out.waypoints[0].profile, "curvy");
  assert.equal(out.waypoints[1].profile, "fast");
  assert.equal(out.roundTrip, false);
});

test("dekodiert Namen mit Sonderzeichen", () => {
  const out = parseDeepLink(
    "?wp=1,2,curvy,Donostia%2C%20Gipuzkoa;3,4,curvy,Sant%20Juli%C3%A0",
    makeId,
  );
  assert.equal(out?.waypoints[0].label, "Donostia, Gipuzkoa");
  assert.equal(out?.waypoints[1].label, "Sant Julià");
});

test("erkennt die Rundtour", () => {
  const out = parseDeepLink("?wp=1,2,curvy;3,4,curvy&rt=1", makeId);
  assert.equal(out?.roundTrip, true);
});

test("erzeugt ein Label, wenn kein Name im Link steht", () => {
  const out = parseDeepLink("?wp=1,2,curvy;3,4,curvy", makeId);
  assert.ok(out);
  assert.ok(out.waypoints[0].label.length > 0);
});

test("gibt null zurück, wenn kein Parameter da ist", () => {
  assert.equal(parseDeepLink("", makeId), null);
  assert.equal(parseDeepLink("?foo=bar", makeId), null);
});

test("gibt null zurück, wenn weniger als zwei Wegpunkte gültig sind", () => {
  assert.equal(parseDeepLink("?wp=1,2,curvy", makeId), null);
  assert.equal(parseDeepLink("?wp=abc,def,curvy;x,y,z", makeId), null);
});

test("ersetzt ein unbekanntes Profil durch curvy", () => {
  const out = parseDeepLink("?wp=1,2,sport;3,4,curvy", makeId);
  assert.equal(out?.waypoints[0].profile, "curvy");
});

test("überspringt ungültige Einträge, behält die gültigen", () => {
  const out = parseDeepLink("?wp=1,2,curvy;kaputt;3,4,curvy", makeId);
  assert.equal(out?.waypoints.length, 2);
});

test("begrenzt die Anzahl der Wegpunkte", () => {
  const many = Array.from({ length: 40 }, (_, i) => `${i},${i},curvy`).join(";");
  const out = parseDeepLink(`?wp=${many}`, makeId);
  assert.equal(out?.waypoints.length, 25);
});
