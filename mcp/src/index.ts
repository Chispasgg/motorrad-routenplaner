// MCP-Server (Streamable HTTP). Vorläufig nur mit einem ping-Werkzeug, um die
// SDK-Anbindung zu verifizieren; die echten Werkzeuge kommen in tools.ts.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config.js";

// Zustandslos: Für jede Anfrage wird eine neue McpServer-Instanz mit den
// registrierten Werkzeugen erstellt (SDK-Anforderung für stateless-Transport).
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: "motorrad-routenplaner", version: "0.1.0" });

  mcp.registerTool(
    "ping",
    {
      description: "Antwortet mit pong. Nur zur Überprüfung der Verbindung.",
      inputSchema: { echo: z.string().optional() },
    },
    async ({ echo }) => ({
      content: [{ type: "text", text: echo ? `pong: ${echo}` : "pong" }],
    }),
  );

  return mcp;
}

const http = createServer((req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", async () => {
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
