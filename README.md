<div align="center">

<pre>
  ██████╗ ███████╗ █████╗ ██╗  ████████╗██╗███╗   ███╗███████╗
  ██╔══██╗██╔════╝██╔══██╗██║  ╚══██╔══╝██║████╗ ████║██╔════╝
██████╔╝█████╗  ███████║██║     ██║   ██║██╔████╔██║█████╗
██╔══██╗██╔══╝  ██╔══██║██║     ██║   ██║██║╚██╔╝██║██╔══╝
  ██║  ██║███████╗██║  ██║███████╗██║   ██║██║ ╚═╝ ██║███████╗
  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝╚═╝     ╚═╝╚══════╝
</pre>

### Side-by-side demo of SSE · Long Polling · WebSocket · WebTransport (HTTP/3 / QUIC)

[![Node.js](https://img.shields.io/badge/Node-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)

</div>

A single Node.js server publishes the same simulated stock-ticker feed over
four different transports. The browser opens **all four at once** and shows
each one in its own panel — same data, different protocols. You can watch
the latency, byte counts and reconnect events drift apart in real time.

| Transport | Path | Direction | Notes |
|---|---|---|---|
| **Server-Sent Events** | `GET /sse` (`text/event-stream`) | server → client | Browser handles reconnect via `EventSource`. Plain HTTP/1.1. |
| **Long polling** | `GET /longpoll?since=N` | one batch per request | Works on any proxy / firewall. Overhead grows with frequency. |
| **WebSocket** | `Upgrade /ws` | full duplex over TCP | One handshake, then framed binary. |
| **WebTransport** | `https://localhost:4444/wt` | full duplex over QUIC | UDP + multiplexed streams, HTTP/3 era. |

## Install + run

```bash
npm install                          # express + ws
node scripts/gen-cert.js             # one-shot: ECDSA cert for QUIC
pip install --user aioquic           # for the QUIC sidecar

# terminal 1 — Node serves SSE / Long Poll / WebSocket
PORT=9090 node server/index.js

# terminal 2 — Python aioquic serves WebTransport on UDP/4444
python3 server/webtransport_sidecar.py \
    --cert certs/cert.pem --key certs/key.pem --port 4444
```

Open <http://localhost:9090>. The page auto-starts all four panels.

### Why a Python sidecar for QUIC?

The current Node WebTransport library
(`@fails-components/webtransport` 1.6.3) fails to actually bind UDP on
Linux with Node 22 — `startServer()` returns silently and no listener
opens. The reference Python implementation `aioquic` works out of the
box, so we run it as a tiny sidecar and keep all of the other transports
in Node. When upstream Node WebTransport support stabilises we'll fold
the sidecar back in.

### No browser flags

The client pulls the SHA-256 hash of the cert from `/meta` and passes it
to the `WebTransport` constructor via `serverCertificateHashes`. Chrome 102+
and Firefox 114+ both accept this without any command-line flag or
trusted CA install.

```js
new WebTransport(url, {
  serverCertificateHashes: [{ algorithm: "sha-256", value: hashBytes }],
});
```

The cert lifetime is capped at 14 days; re-run `node scripts/gen-cert.js`
when it expires.

## Benchmark

A tiny headless benchmark hammers the three TCP-based endpoints with a
configurable number of clients:

```bash
node benchmark/bench.js --clients 50 --seconds 15
```

Output is markdown so you can paste it straight into release notes.

## What you'll see

- **SSE** is the smallest amount of code, has automatic reconnects and
  works through every corporate proxy. Slightly higher per-message overhead
  than WS because every message is wrapped in `data: …\n\n`.
- **Long polling** survives the most hostile network conditions but eats
  TCP connections — at 250 ms tick rate it opens ~4 requests / second per
  client. Watch the byte counter climb fastest here.
- **WebSocket** has the lowest per-message overhead and supports
  duplex. The reconnect counter goes up if the page is left in the
  background by some browsers (they kill idle TCP).
- **WebTransport** finishes its TLS handshake faster (single UDP exchange)
  and survives IP changes (connection migration) — both visible if you
  switch from wifi to mobile data while the page is open.

## Project layout

```
RealtimeProtocols/
├── server/
│   ├── index.js                  # Node HTTP + WS host (SSE / Long Poll / WS)
│   ├── source.js                 # synthetic ticker (EventEmitter)
│   ├── sse.js
│   ├── longpoll.js
│   ├── wsHandler.js
│   ├── webtransport.js           # Node QUIC stub (kept for future use)
│   └── webtransport_sidecar.py   # aioquic-based WebTransport server
├── public/
│   ├── index.html                # 4-panel UI
│   ├── style.css
│   └── client/
│       ├── metrics.js
│       ├── sse.js
│       ├── longpoll.js
│       ├── ws.js
│       ├── webtransport.js       # uses serverCertificateHashes
│       └── main.js
├── benchmark/bench.js            # headless 3-transport throughput test
├── scripts/gen-cert.js           # ECDSA cert for the QUIC sidecar
└── package.json
```

## License

MIT — see [`LICENSE`](./LICENSE).
