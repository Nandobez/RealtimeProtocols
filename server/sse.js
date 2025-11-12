/**
 * Server-Sent Events handler.
 *
 * Long-lived HTTP response, content-type ``text/event-stream``. The browser
 * uses the ``EventSource`` API, automatically reconnects on drop. One-way
 * server → client.
 */
import { ticker } from "./source.js";

export function sseHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",     // disable nginx buffering when proxied
  });
  res.write(`retry: 2000\n\n`);    // hint client reconnect delay

  const onTick = (tick) => {
    res.write(`event: tick\n`);
    res.write(`id: ${tick.seq}\n`);
    res.write(`data: ${JSON.stringify(tick)}\n\n`);
  };

  ticker.on("tick", onTick);

  // Keep the connection alive across proxies that idle-close TCP after 30s.
  const keepalive = setInterval(() => res.write(`: keepalive\n\n`), 15000);

  req.on("close", () => {
    ticker.off("tick", onTick);
    clearInterval(keepalive);
  });
}
