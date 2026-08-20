// MCP-Server (Streamable HTTP) für die Routenplanung. Die Werkzeuge selbst
// stehen in tools.ts; hier geht es nur um Transport und Lebenszyklus.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { registerTools } from "./tools.js";
import { backend } from "./backend.js";

/** Obergrenze für den Anfrage-Rumpf. Werkzeugaufrufe sind wenige Kilobyte groß. */
const MAX_BODY_BYTES = 1_000_000;

// Zustandslos: Für jede Anfrage wird eine neue McpServer-Instanz mit den
// registrierten Werkzeugen erstellt (SDK-Anforderung für stateless-Transport).
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: "motorrad-routenplaner", version: "0.1.0" });
  registerTools(mcp, backend, config.publicWebUrl, config.maxPoints);
  return mcp;
}

const http = createServer((req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  // Bricht die Verbindung während des Lesens ab, feuert der Stream ein
  // "error"-Ereignis. Ohne Listener wird daraus eine uncaughtException, die den
  // Prozess beendet – der Container würde nur durch den Neustart gerettet.
  req.on("error", (err) => {
    console.error("Anfrage-Fehler:", err);
    if (!res.headersSent) res.writeHead(400).end();
  });

  let raw = "";
  let aborted = false;
  req.on("data", (chunk) => {
    if (aborted) return;
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      // Kein legitimer Werkzeugaufruf ist so groß; abbrechen statt Speicher füllen.
      aborted = true;
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: `Request body exceeds ${MAX_BODY_BYTES} bytes` },
      }));
      req.destroy();
    }
  });
  req.on("end", async () => {
    if (aborted) return;
    // Fehlerbehandlung: JSON-Parse-Fehler und connect()-Fehler dürfen den
    // Client nicht hängen lassen.
    try {
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Ungültiger JSON → JSON-RPC Parse Error (code -32700)
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: Invalid JSON" },
        }));
        return;
      }
      // Zustandslos: keine Session-IDs, jede Anfrage erhält eine eigene Instanz.
      const mcp = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
});

http.listen(config.port, config.host, () => {
  console.log(`MCP-Server auf http://${config.host}:${config.port}/mcp`);
});
