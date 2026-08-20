import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLiveEvent, emptyLiveState } from "../src/live.js";
import type { LiveEvent } from "../src/live.js";

const start: LiveEvent = {
  type: "start",
  waypoints: [
    { lng: 1, lat: 2, label: "Bilbao" },
    { lng: 3, lat: 4, label: "Gernika" },
  ],
  roundTrip: false,
  segments: 1,
};

test("el estado vacío no tiene nada pendiente", () => {
  const s = emptyLiveState();
  assert.equal(s.active, false);
  assert.equal(s.line.length, 0);
  assert.equal(s.waypoints.length, 0);
  assert.equal(s.done, null);
});

test("un start activa el estado y guarda los waypoints", () => {
  const s = applyLiveEvent(emptyLiveState(), start);
  assert.equal(s.active, true);
  assert.equal(s.waypoints.length, 2);
  assert.equal(s.waypoints[0].label, "Bilbao");
  assert.equal(s.segments, 1);
});

test("acumula la línea con cada tramo", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, {
    type: "leg",
    index: 0,
    coordinates: [
      [0, 0],
      [1, 1],
    ],
    distanceM: 10,
    durationS: 1,
  });
  s = applyLiveEvent(s, {
    type: "leg",
    index: 1,
    coordinates: [[2, 2]],
    distanceM: 5,
    durationS: 1,
  });
  assert.deepEqual(s.line, [
    [0, 0],
    [1, 1],
    [2, 2],
  ]);
  assert.equal(s.legsDone, 2);
  assert.equal(s.distanceM, 15);
});

test("un done cierra la planificación y expone la ruta", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, { type: "done", route: { distanceM: 99 } });
  assert.equal(s.active, false);
  assert.deepEqual(s.done, { distanceM: 99 } as never);
});

test("un start nuevo descarta el progreso anterior", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, {
    type: "leg",
    index: 0,
    coordinates: [[9, 9]],
    distanceM: 1,
    durationS: 1,
  });
  s = applyLiveEvent(s, { ...start, segments: 3 });
  assert.equal(s.line.length, 0);
  assert.equal(s.legsDone, 0);
  assert.equal(s.segments, 3);
});

test("un error desactiva y guarda el motivo", () => {
  let s = applyLiveEvent(emptyLiveState(), start);
  s = applyLiveEvent(s, { type: "error", message: "kaputt" });
  assert.equal(s.active, false);
  assert.equal(s.error, "kaputt");
});

test("ignora tramos que llegan sin un start previo", () => {
  const s = applyLiveEvent(emptyLiveState(), {
    type: "leg",
    index: 0,
    coordinates: [[1, 1]],
    distanceM: 1,
    durationS: 1,
  });
  assert.equal(s.line.length, 0);
});

test("no muta el estado que recibe", () => {
  const a = applyLiveEvent(emptyLiveState(), start);
  const before = a.line.length;
  applyLiveEvent(a, {
    type: "leg",
    index: 0,
    coordinates: [[1, 1]],
    distanceM: 1,
    durationS: 1,
  });
  assert.equal(a.line.length, before);
});
