import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepLink } from "../src/deeplink.js";

const BASE = "http://192.168.65.9:9640";

test("baut einen Link mit zwei Wegpunkten", () => {
  const url = buildDeepLink(BASE, [
    { lng: -2.935, lat: 43.263, profile: "curvy", name: "Bilbao" },
    { lng: -0.549, lat: 42.571, profile: "fast", name: "Jaca" },
  ], false);
  assert.equal(
    url,
    "http://192.168.65.9:9640/?wp=-2.935,43.263,curvy,Bilbao;-0.549,42.571,fast,Jaca",
  );
});

test("lässt den Namen weg, wenn keiner angegeben ist", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], false);
  assert.equal(url, "http://192.168.65.9:9640/?wp=1,2,curvy;3,4,curvy");
});

test("kodiert Namen mit Sonderzeichen", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy", name: "Donostia, Gipuzkoa" },
    { lng: 3, lat: 4, profile: "curvy", name: "Sant Julià" },
  ], false);
  assert.ok(url.includes("Donostia%2C%20Gipuzkoa"), url);
  assert.ok(url.includes("Sant%20Juli%C3%A0"), url);
  // Die Trennzeichen dürfen nicht aus einem Namen stammen können.
  assert.equal(url.split(";").length, 2);
});

test("markiert eine Rundtour", () => {
  const url = buildDeepLink(BASE, [
    { lng: 1, lat: 2, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], true);
  assert.ok(url.endsWith("&rt=1"), url);
});

test("rundet Koordinaten auf sechs Dezimalstellen", () => {
  const url = buildDeepLink(BASE, [
    { lng: -2.9350039123456, lat: 43.2630018987654, profile: "curvy" },
    { lng: 3, lat: 4, profile: "curvy" },
  ], false);
  assert.ok(url.includes("-2.935004,43.263002"), url);
});

test("verlangt mindestens zwei Wegpunkte", () => {
  assert.throws(() => buildDeepLink(BASE, [{ lng: 1, lat: 2, profile: "curvy" }], false));
});
