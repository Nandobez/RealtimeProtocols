import { createPanel } from "./metrics.js";

const panel = createPanel("webtransport");
let transport = null;
let abort = false;

export async function startWebTransport() {
  if (transport) return;
  if (!("WebTransport" in window)) {
    panel.onStatus("WebTransport unsupported in this browser", "status-error");
    return;
  }

  const meta = await (await fetch("/meta")).json().catch(() => ({}));
  const url = meta.webtransport ?? `https://${location.hostname}:4444/wt`;
  panel.onStatus(`dial ${url}`, "status-warn");

  // Pin the self-signed cert by SHA-256 so we don't need browser flags or
  // a trusted CA. The server publishes the digest under /meta.cert_sha256.
  const options = {};
  if (meta.cert_sha256) {
    const bytes = new Uint8Array(
      meta.cert_sha256.match(/.{2}/g).map((b) => parseInt(b, 16)),
    );
    options.serverCertificateHashes = [{ algorithm: "sha-256", value: bytes }];
  }

  try {
    transport = new WebTransport(url, options);
    await transport.ready;
  } catch (e) {
    panel.onStatus("dial failed (cert?) " + e.message, "status-error");
    transport = null;
    return;
  }
  panel.onStatus("open");

  // The server opens a unidirectional stream and writes NDJSON ticks into it.
  // We pick that stream up via incomingUnidirectionalStreams.
  abort = false;
  const reader = transport.incomingUnidirectionalStreams.getReader();
  const decoder = new TextDecoder();
  while (!abort) {
    const { value: stream, done } = await reader.read();
    if (done || !stream) break;
    panel.onStatus("stream open");
    let buffer = "";
    const streamReader = stream.getReader();
    while (!abort) {
      const { value, done: sDone } = await streamReader.read();
      if (sDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const tick = JSON.parse(line);
          panel.onTick(tick, line.length);
        } catch {/* ignore */}
      }
    }
  }
  panel.onStatus("closed");
}

export function stopWebTransport() {
  abort = true;
  if (transport) transport.close();
  transport = null;
}

export { panel as wtPanel };
