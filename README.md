# hello-world-mcp

A minimal MCP server Node server.

## Run

```bash
npm install
npm start          # PORT=3000 by default
```

Endpoint: `http://localhost:3000/mcp` · Health check: `http://localhost:3000/health`

## What it exposes
or
| Kind | Name | Description |
| --- | --- | --- |
| Tool | `say_hello` | Takes `name` (defaults to `World`), returns `Hello, <name>!` |
| Resource | `hello://greeting` | Static `Hello, world!` text |
| Prompt | `greet` | Asks the model to write a greeting for `name` |

## Transport details

- Stateless: no `Mcp-Session-Id` is issued and none is expected. Each request builds its own `McpServer` + transport, then throws both away, so any replica can serve any request.
- `POST /mcp` — client→server messages. `GET` and `DELETE` return `405`: with no session there is nothing to stream over or terminate, so server→client notifications aren't available.
- Responses are SSE by default. Set `enableJsonResponse: true` on the transport for plain JSON instead.
- DNS-rebinding protection is on, with `allowedHosts` limited to `localhost`/`127.0.0.1`. Add your public host there before deploying.

## Docker

```bash
docker build -t hello-world-mcp:latest .
docker run --rm -p 3000:3000 hello-world-mcp:latest
```

Multi-stage build on `node:26-alpine`: production deps only (`npm ci --omit=dev`), runs as the
non-root `node` user, with a `HEALTHCHECK` against `/health`. `node` is PID 1 and handles
`SIGTERM` via the signal handlers in `server.js`, so `docker stop` exits cleanly (code 0).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` so the container is reachable) |
| `MCP_ALLOWED_HOSTS` | `localhost:$PORT,127.0.0.1:$PORT` | Comma-separated hosts accepted in the `Host` header |

`MCP_ALLOWED_HOSTS` matters once the server is reached under any other name — behind a proxy or
a published hostname, a request whose `Host` isn't listed is rejected with **403**:

```bash
docker run --rm -p 8080:3000 \
  -e MCP_ALLOWED_HOSTS=mcp.example.com,localhost:8080 \
  hello-world-mcp:latest
```

## Connect from Claude Code

```bash
claude mcp add --transport http hello-world http://localhost:3000/mcp
```

## Try it with curl

```bash
# 1. initialize — no session header comes back; nothing to carry forward
curl -i -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 2. call the tool — a standalone request, no handshake needed first
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"say_hello","arguments":{"name":"Elvis"}}}'
```

Or point the MCP Inspector at the URL: `npm run inspect`.
