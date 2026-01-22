import { createPanel } from "./metrics.js";

const panel = createPanel("ws");
let ws = null;

export function startWS() {
  if (ws) return;
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  panel.onStatus("connecting…", "status-warn");
  ws = new WebSocket(url);

  ws.onopen = () => panel.onStatus("open");
  ws.onclose = () => {
    panel.onStatus("closed", "status-warn");
    ws = null;
  };
  ws.onerror = () => {
    panel.onStatus("error", "status-error");
    panel.onReconnect();
  };
  ws.onmessage = (e) => {
    let tick;
    try {
      tick = JSON.parse(e.data);
    } catch {
      return;
    }
    if (tick.type === "pong") return;
    panel.onTick(tick, e.data.length);
  };
}

export function stopWS() {
  if (ws) ws.close();
  ws = null;
}

export { panel as wsPanel };
