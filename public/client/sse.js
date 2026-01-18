import { createPanel } from "./metrics.js";

const panel = createPanel("sse");
let es = null;

export function startSSE() {
  if (es) return;
  es = new EventSource("/sse");
  panel.onStatus("connecting…", "status-warn");

  es.onopen = () => panel.onStatus("open");
  es.onerror = () => {
    panel.onStatus("reconnecting", "status-warn");
    panel.onReconnect();
  };
  es.addEventListener("tick", (e) => {
    const tick = JSON.parse(e.data);
    panel.onTick(tick, e.data.length);
  });
}

export function stopSSE() {
  if (!es) return;
  es.close();
  es = null;
  panel.onStatus("stopped");
}

export { panel as ssePanel };
