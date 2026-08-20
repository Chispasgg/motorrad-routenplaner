import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRouteStore, RouteStoreError } from "../src/services/routeStore.js";
import type { StoredWaypoint } from "../src/services/routeStore.js";

/** Legt einen Store in einem temporären Verzeichnis an und räumt danach auf. */
function withStore(
  run: (store: ReturnType<typeof createRouteStore>) => void,
  now?: () => string,
): void {
  const dir = mkdtempSync(join(tmpdir(), "routestore-"));
  try {
    run(createRouteStore(join(dir, "routes.db"), now));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WPS: StoredWaypoint[] = [
  { lng: -2.935, lat: 43.263, label: "Bilbao", profile: "curvy" },
  { lng: -2.679, lat: 43.316, label: "Gernika", profile: "fast" },
];

test("legt eine Route an und liest sie unverändert zurück", () => {
  withStore((store) => {
    const created = store.create({ name: "Bilbao → Gernika", roundTrip: false, waypoints: WPS });
    assert.ok(created.id > 0);
    const read = store.get(created.id);
    assert.equal(read?.name, "Bilbao → Gernika");
    assert.equal(read?.roundTrip, false);
    assert.deepEqual(read?.waypoints, WPS);
  });
});

test("liefert in der Liste eine Zusammenfassung ohne Wegpunkte", () => {
  withStore((store) => {
    store.create({ name: "Eine", roundTrip: true, waypoints: WPS });
    const list = store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].pointCount, 2);
    assert.equal(list[0].roundTrip, true);
    assert.equal("waypoints" in list[0], false);
  });
});

test("aktualisiert updated_at und lässt created_at unberührt", () => {
  const stamps = ["2026-01-01T00:00:00.000Z", "2026-06-15T12:30:00.000Z"];
  let i = 0;
  withStore((store) => {
    const created = store.create({ name: "Alt", roundTrip: false, waypoints: WPS });
    assert.equal(created.createdAt, stamps[0]);
    const updated = store.update(created.id, { name: "Neu" });
    assert.equal(updated?.name, "Neu");
    assert.equal(updated?.createdAt, stamps[0]);
    assert.equal(updated?.updatedAt, stamps[1]);
  }, () => stamps[Math.min(i++, stamps.length - 1)]);
});

test("ändert beim Umbenennen die Wegpunkte nicht", () => {
  withStore((store) => {
    const created = store.create({ name: "Alt", roundTrip: false, waypoints: WPS });
    const updated = store.update(created.id, { name: "Neu" });
    assert.deepEqual(updated?.waypoints, WPS);
  });
});

test("ersetzt beim Aktualisieren der Wegpunkte den Namen nicht", () => {
  withStore((store) => {
    const created = store.create({ name: "Behalten", roundTrip: false, waypoints: WPS });
    const andere: StoredWaypoint[] = [
      { lng: 1, lat: 2, label: "A", profile: "fast" },
      { lng: 3, lat: 4, label: "B", profile: "fast" },
      { lng: 5, lat: 6, label: "C", profile: "curvy" },
    ];
    const updated = store.update(created.id, { waypoints: andere });
    assert.equal(updated?.name, "Behalten");
    assert.equal(updated?.waypoints.length, 3);
  });
});

test("löscht einmal erfolgreich und danach nicht mehr", () => {
  withStore((store) => {
    const created = store.create({ name: "Weg", roundTrip: false, waypoints: WPS });
    assert.equal(store.remove(created.id), true);
    assert.equal(store.remove(created.id), false);
    assert.equal(store.get(created.id), null);
  });
});

test("gibt bei unbekannter Kennung null zurück statt zu werfen", () => {
  withStore((store) => {
    assert.equal(store.get(9999), null);
    assert.equal(store.update(9999, { name: "X" }), null);
  });
});

test("weist einen leeren oder zu langen Namen ab", () => {
  withStore((store) => {
    assert.throws(
      () => store.create({ name: "  ", roundTrip: false, waypoints: WPS }),
      RouteStoreError,
    );
    const lang = "x".repeat(121);
    assert.throws(
      () => store.create({ name: lang, roundTrip: false, waypoints: WPS }),
      RouteStoreError,
    );
  });
});

test("verlangt mindestens zwei Wegpunkte", () => {
  withStore((store) => {
    assert.throws(
      () => store.create({ name: "Kurz", roundTrip: false, waypoints: [WPS[0]] }),
      RouteStoreError,
    );
  });
});

test("weist ungültige Profile und Koordinaten ab", () => {
  withStore((store) => {
    assert.throws(
      () => store.create({
        name: "Falsch",
        roundTrip: false,
        waypoints: [WPS[0], { lng: 0, lat: 0, label: "X", profile: "sport" as never }],
      }),
      RouteStoreError,
    );
    assert.throws(
      () => store.create({
        name: "Falsch",
        roundTrip: false,
        waypoints: [WPS[0], { lng: 999, lat: 0, label: "X", profile: "fast" }],
      }),
      RouteStoreError,
    );
  });
});

test("überlebt das Schließen und erneute Öffnen der Datei", () => {
  const dir = mkdtempSync(join(tmpdir(), "routestore-"));
  try {
    const path = join(dir, "routes.db");
    const first = createRouteStore(path);
    const created = first.create({ name: "Bleibt", roundTrip: false, waypoints: WPS });
    const second = createRouteStore(path);
    assert.equal(second.get(created.id)?.name, "Bleibt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
