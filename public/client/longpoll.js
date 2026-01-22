import { createPanel } from "./metrics.js";

const panel = createPanel("longpoll");
let running = false;
let aborter = null;
let since = 0;

export async function startLongPoll() {
  if (running) return;
  running = true;
  panel.onStatus("polling", "status-warn");

  while (running) {
    aborter = new AbortController();
    let body;
    try {
      const res = await fetch(`/longpoll?since=${since}`, { signal: aborter.signal });
      body = await res.json();
      panel.onStatus("ok");
    } catch (e) {
      if (!running) break;
      panel.onStatus("retry", "status-warn");
      panel.onReconnect();
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    for (const tick of body.ticks ?? []) {
      since = Math.max(since, tick.seq);
      panel.onTick(tick, JSON.stringify(tick).length);
    }
  }
}

export function stopLongPoll() {
  running = false;
  if (aborter) aborter.abort();
  panel.onStatus("stopped");
}

export { panel as longpollPanel };
