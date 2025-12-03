/**
 * WebSocket handler.
 *
 * Single TCP connection, framed binary protocol over the HTTP Upgrade
 * mechanism. Full duplex from the start, low per-message overhead, but
 * connection setup costs an HTTP handshake.
 */
import { WebSocketServer } from "ws";
import { ticker } from "./source.js";

export function attachWebSocket(server, path = "/ws") {
  const wss = new WebSocketServer({ server, path });

  wss.on("connection", (socket) => {
    const onTick = (t) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(t));
    };
    ticker.on("tick", onTick);
    socket.on("close", () => ticker.off("tick", onTick));
    socket.on("message", (msg) => {
      // Echo a ping → pong with the same monotonic id so the client can
      // measure RTT through the same socket.
      try {
        const obj = JSON.parse(msg.toString());
        if (obj?.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", id: obj.id, ts: Date.now() }));
        }
      } catch {/* ignore */ }
    });
  });

  return wss;
}
