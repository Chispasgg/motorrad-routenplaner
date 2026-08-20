import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDistance, formatDuration, formatRouteSummary } from "../src/format.js";

test("formatiert Distanzen", () => {
  assert.equal(formatDistance(147746), "147,7 km");
  assert.equal(formatDistance(950), "950 m");
});

test("formatiert Fahrzeiten", () => {
  assert.equal(formatDuration(11820), "3 h 17 min");
  assert.equal(formatDuration(600), "10 min");
});

test("fasst eine Route mit Abschnitten zusammen", () => {
  const text = formatRouteSummary({
    labels: ["Bilbao", "Jaca"],
    roundTrip: false,
    profiles: ["curvy"],
    route: {
      geojson: null,
      distanceM: 147746,
      durationS: 11820,
      legs: [{ distanceM: 147746, durationS: 11820 }],
      features: [],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(text.includes("147,7 km"), text);
  assert.ok(text.includes("3 h 17 min"), text);
  assert.ok(text.includes("Bilbao"), text);
  assert.ok(text.includes("http://web/?wp=x"), text);
});

test("nennt Maut und Fähren, wenn vorhanden", () => {
  const text = formatRouteSummary({
    labels: ["A", "B"],
    roundTrip: false,
    profiles: ["fast"],
    route: {
      geojson: null,
      distanceM: 1000,
      durationS: 600,
      legs: [{ distanceM: 1000, durationS: 600 }],
      features: [
        { lng: 0, lat: 0, kind: "toll", lengthM: 4200, atM: 500, label: "Maut" },
        { lng: 1, lat: 1, kind: "ferry", lengthM: 800, atM: 900, label: "Fähre" },
      ],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(/Maut/.test(text), text);
  assert.ok(/Fähre/.test(text), text);
});

test("markiert den Rückweg einer Rundtour", () => {
  const text = formatRouteSummary({
    labels: ["A", "B"],
    roundTrip: true,
    profiles: ["curvy", "curvy"],
    route: {
      geojson: null,
      distanceM: 2000,
      durationS: 1200,
      legs: [{ distanceM: 1000, durationS: 600 }, { distanceM: 1000, durationS: 600 }],
      features: [],
    },
    webUrl: "http://web/?wp=x",
  });
  assert.ok(text.includes("A"), text);
  // Der letzte Abschnitt führt zurück zum Start.
  assert.ok(/zurück|Rundtour/i.test(text), text);
});
