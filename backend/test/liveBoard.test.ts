import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveBoard } from "../src/services/liveBoard.js";
import type { LiveEvent } from "../src/types.js";

const start: LiveEvent = {
  type: "start",
  waypoints: [
    { lng: 1, lat: 2, label: "A" },
    { lng: 3, lat: 4, label: "B" },
  ],
  roundTrip: false,
  segments: 1,
};

const leg = (index: number): LiveEvent => ({
  type: "leg",
  index,
  coordinates: [
    [0, 0],
    [1, 1],
  ],
  distanceM: 1000,
  durationS: 60,
});

test("verliert nichts, wenn niemand zuhört", () => {
  const board = createLiveBoard();
  board.publish(start);
  assert.equal(board.subscriberCount(), 0);
  assert.deepEqual(board.snapshot(), [start]);
});

test("schickt neue Ereignisse an alle Zuhörer", () => {
  const board = createLiveBoard();
  const a: LiveEvent[] = [];
  const b: LiveEvent[] = [];
  board.subscribe((e) => a.push(e));
  board.subscribe((e) => b.push(e));
  board.publish(start);
  board.publish(leg(0));
  assert.equal(a.length, 2);
  assert.deepEqual(b, a);
});

test("hält die Folge der letzten Planung fest", () => {
  const board = createLiveBoard();
  board.publish(start);
  board.publish(leg(0));
  board.publish(leg(1));
  assert.equal(board.snapshot().length, 3);
});

test("beginnt bei einem neuen start eine neue Folge", () => {
  const board = createLiveBoard();
  board.publish(start);
  board.publish(leg(0));
  board.publish({ ...start, segments: 2 });
  const snap = board.snapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].type, "start");
});

test("meldet Zuhörer ab und schickt ihnen nichts mehr", () => {
  const board = createLiveBoard();
  const seen: LiveEvent[] = [];
  const off = board.subscribe((e) => seen.push(e));
  board.publish(start);
  assert.equal(board.subscriberCount(), 1);
  off();
  assert.equal(board.subscriberCount(), 0);
  board.publish(leg(0));
  assert.equal(seen.length, 1);
});

test("ein Fehler in einem Zuhörer stoppt die anderen nicht", () => {
  const board = createLiveBoard();
  const seen: LiveEvent[] = [];
  board.subscribe(() => {
    throw new Error("kaputt");
  });
  board.subscribe((e) => seen.push(e));
  board.publish(start);
  assert.equal(seen.length, 1);
});

test("begrenzt die Folge, damit der Speicher nicht wächst", () => {
  const board = createLiveBoard();
  board.publish(start);
  for (let i = 0; i < 500; i++) board.publish(leg(i));
  assert.ok(board.snapshot().length <= 201, `zu lang: ${board.snapshot().length}`);
  // Der start muss erhalten bleiben, sonst kann ein später Zuhörer nichts zeichnen.
  assert.equal(board.snapshot()[0].type, "start");
});
