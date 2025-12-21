/**
 * WebTransport over HTTP/3 (QUIC) handler.
 *
 * QUIC runs on UDP and multiplexes independent streams over a single TLS 1.3
 * connection. WebTransport is the browser API exposing QUIC capabilities.
 *
 * This module is optional — we only start the WebTransport server when
 * ``@fails-components/webtransport`` is installed and the user supplies a
 * TLS cert. See ``scripts/gen-cert.js`` for a quick self-signed cert.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ticker } from "./source.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.resolve(HERE, "..", "certs");

export async function startWebTransport(port = 4444) {
  let Http3Server, quicheLoaded;
  try {
    ({ Http3Server, quicheLoaded } = await import(
      "@fails-components/webtransport"
    ));
  } catch (e) {
    console.warn(
      "[webtransport] @fails-components/webtransport is not installed — " +
        "skipping QUIC server. `npm install` to enable.",
    );
    return null;
  }
  // The library defers loading the quiche backend until the first await.
  try {
    await Promise.race([
      quicheLoaded,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("quiche backend not available")), 5000),
      ),
    ]);
  } catch (e) {
    console.warn(`[webtransport] ${e.message} — skipping QUIC.`);
    return null;
  }

  const certPath = path.join(CERT_DIR, "cert.der");
  const keyPath = path.join(CERT_DIR, "key.der");
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.warn(
      `[webtransport] no certificate found in ${CERT_DIR} — ` +
        "run `node scripts/gen-cert.js` first. Skipping QUIC.",
    );
    return null;
  }

  const cert = fs.readFileSync(certPath);
  const privKey = fs.readFileSync(keyPath);

  const server = new Http3Server({
    port,
    host: "0.0.0.0",
    secret: "duckgpt-realtime-demo",
    cert,
    privKey,
  });
  server.startServer();
  // ``server.ready`` is unreliable across library versions; instead we trust
  // ``startServer()`` synchronously and surface errors via ``onServerError``.
  console.log(
    `[webtransport] HTTP/3 server starting on udp://0.0.0.0:${port}/wt ` +
      "(launch Chrome with the spki flag from `node scripts/gen-cert.js`)",
  );

  (async () => {
    const sessions = server.sessionStream("/wt");
    const reader = sessions.getReader();
    while (true) {
      const { value: session, done } = await reader.read();
      if (done) break;
      handleSession(session).catch((err) =>
        console.warn("[webtransport] session error:", err.message),
      );
    }
  })();

  return server;
}

async function handleSession(session) {
  await session.ready;

  const stream = await session.createBidirectionalStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const onTick = async (t) => {
    try {
      await writer.write(encoder.encode(JSON.stringify(t) + "\n"));
    } catch {
      ticker.off("tick", onTick);
    }
  };
  ticker.on("tick", onTick);
  session.closed.finally(() => ticker.off("tick", onTick));
}
