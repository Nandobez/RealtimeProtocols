/**
 * Per-panel metrics + log rendering.
 *
 * Each transport panel exposes the same API:
 *
 *     const panel = createPanel("sse");
 *     panel.start({...});
 *     panel.stop();
 *     panel.onTick(t, sizeBytes);
 *     panel.onError(msg);
 *     panel.onStatus(text);
 *
 * The DOM is selected via ``[data-protocol="<name>"]``.
 */

const FIELDS = ["msgs", "latencyMs", "bytes", "reconnects"];

export function createPanel(name) {
  const root = document.querySelector(`.panel[data-protocol="${name}"]`);
  if (!root) throw new Error(`no panel for ${name}`);

  const metricsEl = root.querySelector(".metrics");
  const logEl = root.querySelector(".log");

  metricsEl.innerHTML = FIELDS.map(
    (f) => `
    <div class="metric">
      <div class="label">${labelFor(f)}</div>
      <div class="value" data-field="${f}">—</div>
    </div>
  `,
  ).join("");

  const state = {
    msgs: 0,
    bytes: 0,
    reconnects: 0,
    latencyMs: 0,
    _latencies: [],
  };

  const set = (k, v) => {
    state[k] = v;
    const node = metricsEl.querySelector(`[data-field="${k}"]`);
    if (node) node.textContent = render(k, v);
  };

  const log = (tick, latency) => {
    if (logEl.childElementCount > 80) logEl.removeChild(logEl.lastChild);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="seq">#${tick.seq}</span>
                     <span class="sym">${tick.symbol}</span>
                     <span class="px">$${tick.price}</span>
                     <span class="lat">${latency >= 0 ? latency.toFixed(0) + "ms" : "—"}</span>`;
    logEl.insertBefore(row, logEl.firstChild);
  };

  return {
    onTick(tick, sizeBytes) {
      const lat = tick.ts ? Date.now() - tick.ts : -1;
      state.msgs += 1;
      state.bytes += sizeBytes ?? 0;
      if (lat >= 0) {
        state._latencies.push(lat);
        if (state._latencies.length > 32) state._latencies.shift();
        const avg =
          state._latencies.reduce((a, b) => a + b, 0) / state._latencies.length;
        set("latencyMs", Math.round(avg));
      }
      set("msgs", state.msgs);
      set("bytes", state.bytes);
      log(tick, lat);
    },
    onReconnect() {
      set("reconnects", state.reconnects + 1);
    },
    onStatus(text, cls = "status-ok") {
      const id = `status-${name}`;
      let span = document.getElementById(id);
      if (!span) {
        span = document.createElement("span");
        span.id = id;
        span.style.marginRight = "1rem";
        document.getElementById("status").appendChild(span);
      }
      span.textContent = `${name}: ${text}`;
      span.className = cls;
    },
    reset() {
      state.msgs = state.bytes = state.reconnects = 0;
      state._latencies = [];
      FIELDS.forEach((f) => set(f, 0));
      logEl.innerHTML = "";
    },
    state,
  };
}

function labelFor(f) {
  return { msgs: "MSGS", latencyMs: "AVG LATENCY", bytes: "BYTES", reconnects: "RECONNECTS" }[f];
}

function render(k, v) {
  if (k === "bytes") return formatBytes(v);
  if (k === "latencyMs") return v + " ms";
  return v;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
