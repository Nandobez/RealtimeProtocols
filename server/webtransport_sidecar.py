"""
HopWatch QUIC sidecar.

Uses aioquic to expose a WebTransport endpoint over UDP/HTTP/3. Forwards
ticks from the existing Node SSE feed (``http://localhost:9090/sse``) to
every WebTransport client connected at ``https://localhost:4444/wt``.

Why a sidecar in Python: the @fails-components/webtransport Node library's
``Http3Server.startServer()`` doesn't actually bind a UDP socket on Linux
with Node 22 (silent failure). aioquic is a reference WebTransport
implementation that just works.

Usage::

    python3 server/webtransport_sidecar.py \\
        --cert certs/cert.pem --key certs/key.pem --port 4444 \\
        --upstream http://localhost:9090/sse

The Node server keeps handling SSE / Long Poll / WebSocket.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import ssl
import threading
import time
from collections import deque
from typing import Optional
from urllib.request import urlopen

from aioquic.asyncio import QuicConnectionProtocol, serve
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import H3Event, HeadersReceived, WebTransportStreamDataReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import QuicEvent

logger = logging.getLogger("wt-sidecar")


class TickBus:
    """In-process pub/sub for tick dicts."""

    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        self._lock = threading.Lock()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=512)
        with self._lock:
            self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            if q in self._queues:
                self._queues.remove(q)

    def publish(self, payload: dict) -> None:
        with self._lock:
            queues = list(self._queues)
        for q in queues:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass


SYMBOLS = ["DUCK", "GPT", "BTC", "USD", "TSLA", "MSFT", "GOOG"]


async def local_ticker(bus: TickBus, tick_ms: int = 250) -> None:
    """Generate ticks directly inside the asyncio loop so there is no proxy
    chain between the source and the WebTransport client. Same shape as the
    Node side; ``seq`` starts independently so you can tell ports apart.
    """
    import random

    prices = {s: 100 + random.random() * 50 for s in SYMBOLS}
    seq = 0
    while True:
        symbol = random.choice(SYMBOLS)
        delta = (random.random() - 0.5) * 2
        prices[symbol] = max(0.01, prices[symbol] + delta)
        seq += 1
        bus.publish({
            "seq": seq,
            "ts": int(time.time() * 1000),
            "symbol": symbol,
            "price": round(prices[symbol], 4),
            "delta": round(delta, 4),
        })
        await asyncio.sleep(tick_ms / 1000)


class WebTransportH3Server(QuicConnectionProtocol):
    """One QUIC connection. Handles WebTransport CONNECT and pumps ticks
    down a unidirectional stream for as long as the session lives.
    """

    def __init__(self, *args, bus: TickBus, path: bytes, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._http: Optional[H3Connection] = None
        self._bus = bus
        self._path = path
        self._sessions: dict[int, asyncio.Task] = {}

    def quic_event_received(self, event: QuicEvent) -> None:
        if self._http is None:
            self._http = H3Connection(self._quic, enable_webtransport=True)
        for h3_event in self._http.handle_event(event):
            self._h3_event(h3_event)

    def _h3_event(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived):
            headers = dict(event.headers)
            method = headers.get(b":method")
            protocol = headers.get(b":protocol")
            path = headers.get(b":path", b"")
            if method == b"CONNECT" and protocol == b"webtransport" and path == self._path:
                self._accept_session(event.stream_id)
            else:
                self._http.send_headers(
                    stream_id=event.stream_id,
                    headers=[(b":status", b"404")],
                    end_stream=True,
                )
                self.transmit()

    def _accept_session(self, stream_id: int) -> None:
        self._http.send_headers(
            stream_id=stream_id,
            headers=[(b":status", b"200"), (b"sec-webtransport-http3-draft", b"draft02")],
        )
        self.transmit()
        task = asyncio.create_task(self._pump(stream_id))
        self._sessions[stream_id] = task
        task.add_done_callback(lambda _t: self._sessions.pop(stream_id, None))

    async def _pump(self, session_id: int) -> None:
        queue = self._bus.subscribe()
        try:
            # Create one unidirectional WebTransport stream and write ticks
            # as NDJSON, matching the Node /sse → client contract.
            stream_id = self._http.create_webtransport_stream(
                session_id=session_id, is_unidirectional=True,
            )
            while True:
                tick = await queue.get()
                payload = (json.dumps(tick) + "\n").encode()
                # WebTransport streams carry raw bytes — write via the QUIC
                # layer directly, not the H3 framed sender.
                self._quic.send_stream_data(stream_id, payload, end_stream=False)
                self.transmit()
        except Exception as exc:                                              # noqa: BLE001
            logger.info("session %s ended: %s", session_id, exc)
        finally:
            self._bus.unsubscribe(queue)


async def main(args) -> None:
    bus = TickBus()
    asyncio.create_task(local_ticker(bus, tick_ms=args.tick_ms))

    cfg = QuicConfiguration(is_client=False, alpn_protocols=["h3"])
    cfg.load_cert_chain(args.cert, args.key)
    cfg.max_datagram_frame_size = 65536

    def protocol_factory(*a, **kw):
        return WebTransportH3Server(*a, **kw, bus=bus, path=args.path.encode())

    logger.info("[webtransport] listening on udp://%s:%s%s",
                args.host, args.port, args.path)
    await serve(args.host, args.port, configuration=cfg, create_protocol=protocol_factory)
    await asyncio.Future()   # run forever


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=4444)
    p.add_argument("--cert", required=True)
    p.add_argument("--key", required=True)
    p.add_argument("--path", default="/wt")
    p.add_argument("--tick-ms", type=int, default=250)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(message)s")
    asyncio.run(main(args))
