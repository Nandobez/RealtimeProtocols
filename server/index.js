/**
 * Realtime Protocols Demo — main server.
 *
 *  - HTTP/1.1 listener serves the static UI + the SSE and long-polling
 *    endpoints + the WebSocket upgrade endpoint (port 8080 by default).
 *  - HTTP/3 / WebTransport server optionally runs on UDP/4444.
 */
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fs from "node:fs";
import crypto from "node:crypto";
import { sseHandler } from "./sse.js";
import { longPollHandler } from "./longpoll.js";
import { attachWebSocket } from "./wsHandler.js";
import { startWebTransport } from "./webtransport.js";
import { ticker } from "./source.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "..", "public");

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const WT_PORT = parseInt(process.env.WT_PORT ?? "4444", 10);

const app = express();

app.use((req, _res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`,
  );
  next();
});

app.get("/sse", sseHandler);
app.get("/longpoll", longPollHandler);

// quick health / metadata
function _certHash() {
  try {
    const certPath = path.resolve(HERE, "..", "certs", "cert.der");
    if (!fs.existsSync(certPath)) return null;
    const raw = fs.readFileSync(certPath);
    return crypto.createHash("sha256").update(raw).digest("hex");
  } catch {
    return null;
  }
}

app.get("/meta", (_req, res) => {
  res.json({
    server_seq: ticker.seq,
    symbols: Object.keys(ticker.prices),
    websocket: "/ws",
    webtransport: `https://${process.env.WT_HOST ?? "localhost"}:${WT_PORT}/wt`,
    cert_sha256: _certHash(),
  });
});

app.use(express.static(PUBLIC));

const server = http.createServer(app);
attachWebSocket(server, "/ws");
server.listen(PORT, () =>
  console.log(`[http]    listening on http://localhost:${PORT}`),
);

// HTTP/3 / WebTransport is optional and best-effort
startWebTransport(WT_PORT).catch((err) =>
  console.warn("[webtransport] failed to start:", err.message),
);

process.on("SIGINT", () => {
  console.log("\nshutting down…");
  ticker.stop();
  server.close(() => process.exit(0));
});
