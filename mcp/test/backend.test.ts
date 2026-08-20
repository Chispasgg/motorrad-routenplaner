import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createBackendClient, BackendError } from "../src/backend.js";

/** Startet einen Fake-Backend und liefert seine Basis-URL. */
async function withFakeBackend(
  handler: (url: string, body: unknown) => { status: number; json: unknown },
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  let server: Server | undefined;
  try {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const out = handler(req.url ?? "", raw ? JSON.parse(raw) : undefined);
        res.writeHead(out.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

test("liest Geocoding-Ergebnisse", async () => {
  await withFakeBackend(
    () => ({ status: 200, json: [{ label: "Bilbao", lat: 43.263, lng: -2.935 }] }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      const res = await api.geocode("Bilbao");
      assert.equal(res[0].label, "Bilbao");
    },
  );
});

test("erkennt fehlende Kacheln als Abdeckungsproblem", async () => {
  await withFakeBackend(
    () => ({
      status: 502,
      json: {
        error:
          "BRouter Routing fehlgeschlagen (500): position not mapped in existing datafile",
      },
    }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      await assert.rejects(
        () => api.route([[0, 0], [1, 1]], ["curvy"], []),
        (err: unknown) => err instanceof BackendError && err.kind === "coverage",
      );
    },
  );
});

test("meldet andere Backend-Fehler als upstream", async () => {
  await withFakeBackend(
    () => ({ status: 502, json: { error: "Overpass 504: gateway timeout" } }),
    async (base) => {
      const api = createBackendClient(base, 5000);
      await assert.rejects(
        () => api.pois([[0, 0], [1, 1]], "food", 500),
        (err: unknown) => err instanceof BackendError && err.kind === "upstream",
      );
    },
  );
});

test("meldet einen nicht erreichbaren Backend als unavailable", async () => {
  // Port 1 ist reserviert und nimmt keine Verbindungen an.
  const api = createBackendClient("http://127.0.0.1:1", 2000);
  await assert.rejects(
    () => api.geocode("Bilbao"),
    (err: unknown) => err instanceof BackendError && err.kind === "unavailable",
  );
});

test("bricht bei Zeitüberschreitung ab", async () => {
  let server: Server | undefined;
  try {
    server = createServer(() => { /* antwortet absichtlich nie */ });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const api = createBackendClient(`http://127.0.0.1:${port}`, 300);
    await assert.rejects(
      () => api.geocode("Bilbao"),
      (err: unknown) => err instanceof BackendError && err.kind === "timeout",
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});
