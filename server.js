#!/usr/bin/env node
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const MCP_PATH = "/mcp";

const ALLOWED_HOSTS = (
  process.env.MCP_ALLOWED_HOSTS ?? `localhost:${PORT},127.0.0.1:${PORT}`
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

function createServer() {
  const server = new McpServer({
    name: "hello-world-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "say_hello",
    {
      title: "Say Hello",
      description: "Greets someone by name.",
      inputSchema: {
        name: z.string().default("World").describe("Who to greet"),
      },
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    })
  );

  server.registerResource(
    "greeting",
    "hello://greeting",
    {
      title: "Greeting",
      description: "A static hello world greeting.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "Hello, world!" }],
    })
  );

  server.registerPrompt(
    "greet",
    {
      title: "Greet",
      description: "Ask the model to write a greeting.",
      argsSchema: { name: z.string().describe("Who to greet") },
    },
    ({ name }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Write a short, friendly greeting for ${name}.`,
          },
        },
      ],
    })
  );

  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const jsonRpcError = (code, message) => ({
  jsonrpc: "2.0",
  error: { code, message },
  id: null,
});

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    return sendJson(res, 200, { status: "ok", mode: "stateless" });
  }

  if (url.pathname !== MCP_PATH) {
    return sendJson(res, 404, jsonRpcError(-32004, "Not found"));
  }

  try {
    // POST: client -> server messages. Stateless: every request gets its own
    // McpServer + transport, both discarded once the response is done. No
    // Mcp-Session-Id is issued, and clients need not send one.
    if (req.method === "POST") {
      const body = await readBody(req);

      const transport = new StreamableHTTPServerTransport({
        // `undefined` (not a function returning undefined) is what puts the
        // SDK transport into stateless mode.
        sessionIdGenerator: undefined,
        // Guards against DNS-rebinding attacks from a browser on this machine.
        enableDnsRebindingProtection: true,
        allowedHosts: ALLOWED_HOSTS,
      });

      const server = createServer();

      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      return await transport.handleRequest(req, res, body);
    }

    // No sessions to stream over or terminate.
    if (req.method === "GET" || req.method === "DELETE") {
      res.setHeader("Allow", "POST");
      return sendJson(
        res,
        405,
        jsonRpcError(-32000, "Method not allowed: this server is stateless")
      );
    }

    res.writeHead(405, { Allow: "POST" }).end();
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, jsonRpcError(-32603, "Internal server error"));
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.error(`hello-world-mcp listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.error(`mode: stateless · allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
