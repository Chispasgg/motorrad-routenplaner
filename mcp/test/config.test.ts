import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("nimmt Defaults, wenn nichts gesetzt ist", () => {
  const c = loadConfig({});
  assert.equal(c.port, 8081);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.backendUrl, "http://127.0.0.1:8080");
  assert.equal(c.publicWebUrl, "http://127.0.0.1:9640");
  assert.equal(c.routeTimeoutMs, 180000);
  assert.equal(c.maxPoints, 10);
});

test("entfernt abschließende Schrägstriche der URLs", () => {
  const c = loadConfig({ BACKEND_URL: "http://b:8080/", PUBLIC_WEB_URL: "http://w:9640///" });
  assert.equal(c.backendUrl, "http://b:8080");
  assert.equal(c.publicWebUrl, "http://w:9640");
});

test("lehnt einen ungültigen Port ab", () => {
  assert.throws(() => loadConfig({ MCP_PORT: "0" }), /MCP_PORT/);
  assert.throws(() => loadConfig({ MCP_PORT: "abc" }), /MCP_PORT/);
});

test("lehnt eine ungültige Backend-URL ab", () => {
  assert.throws(() => loadConfig({ BACKEND_URL: "kein-url" }), /BACKEND_URL/);
});

test("lehnt ein ungültiges Zeitlimit ab", () => {
  assert.throws(() => loadConfig({ ROUTE_TIMEOUT_MS: "-5" }), /ROUTE_TIMEOUT_MS/);
});
