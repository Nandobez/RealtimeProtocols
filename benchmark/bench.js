/**
 * Headless benchmark — opens N concurrent clients per transport, measures
 * messages received in a fixed window and prints a markdown summary.
 *
 * Usage: ``node benchmark/bench.js [--clients 50] [--seconds 10]``
 */
import { argv } from "node:process";
import { WebSocket } from "ws";
import { EventSource } from "undici";   // node 21+ ships EventSource

const args = Object.fromEntries(
  argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null)).filter(Boolean),
);
const CLIENTS = parseInt(args.clients ?? "20", 10);
const SECONDS = parseInt(args.seconds ?? "10", 10);
const HOST = args.host ?? "http://localhost:8080";

function ms() {
  return Date.now();
}

async function benchSSE() {
  const start = ms();
  let total = 0;
  const handles = [];
  for (let i = 0; i < CLIENTS; i++) {
    const es = new EventSource(`${HOST}/sse`);
    es.addEventListener("tick", () => (total += 1));
    handles.push(es);
  }
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  handles.forEach((h) => h.close());
  return { total, ms: ms() - start };
}

async function benchLongPoll() {
  const start = ms();
  let total = 0;
  const cancelled = { value: false };
  const runners = Array.from({ length: CLIENTS }, async () => {
    let since = 0;
    while (!cancelled.value) {
      const res = await fetch(`${HOST}/longpoll?since=${since}`);
      const body = await res.json();
      for (const t of body.ticks ?? []) {
        since = Math.max(since, t.seq);
        total += 1;
      }
    }
  });
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  cancelled.value = true;
  await Promise.allSettled(runners);
  return { total, ms: ms() - start };
}

async function benchWS() {
  const start = ms();
  let total = 0;
  const handles = [];
  for (let i = 0; i < CLIENTS; i++) {
    const ws = new WebSocket(`${HOST.replace("http", "ws")}/ws`);
    ws.on("message", () => (total += 1));
    handles.push(ws);
  }
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  handles.forEach((h) => h.close());
  return { total, ms: ms() - start };
}

(async () => {
  console.log(`# Benchmark — ${CLIENTS} concurrent clients, ${SECONDS}s window`);
  const rows = [];
  for (const [label, fn] of [
    ["SSE", benchSSE],
    ["Long polling", benchLongPoll],
    ["WebSocket", benchWS],
  ]) {
    process.stdout.write(`  running ${label}… `);
    const r = await fn();
    rows.push({ label, ...r, perSec: (r.total / SECONDS).toFixed(0) });
    console.log(`${r.total} msgs`);
  }
  console.log("");
  console.log("| Transport | Msgs | Msgs/s | Window (ms) |");
  console.log("|---|---:|---:|---:|");
  rows.forEach((r) =>
    console.log(`| ${r.label} | ${r.total} | ${r.perSec} | ${r.ms} |`),
  );
})();
