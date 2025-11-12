/**
 * Long polling handler.
 *
 * Client sends GET ``/longpoll?since=N``. The server holds the request open
 * until a tick with ``seq > since`` is available, then replies with the
 * batch of pending ticks. Client receives, immediately fires another GET.
 *
 * Pros: works over plain HTTP, every proxy, every browser since 1995.
 * Cons: one TCP request *per batch*; overhead grows with frequency.
 */
import { ticker } from "./source.js";

const HOLD_MS = 25000;             // give up if no tick within this window
const buffer = [];                 // last N ticks for catch-up
const BUFFER_CAP = 256;

ticker.on("tick", (t) => {
  buffer.push(t);
  if (buffer.length > BUFFER_CAP) buffer.shift();
});

export function longPollHandler(req, res) {
  const since = parseInt(req.query.since ?? "0", 10) || 0;
  const cached = buffer.filter((t) => t.seq > since);

  if (cached.length > 0) {
    res.json({ ticks: cached });
    return;
  }

  const onTick = (t) => {
    cleanup();
    res.json({ ticks: [t] });
  };
  const timeout = setTimeout(() => {
    cleanup();
    res.json({ ticks: [] });        // empty -> client polls again
  }, HOLD_MS);
  const cleanup = () => {
    ticker.off("tick", onTick);
    clearTimeout(timeout);
  };

  ticker.on("tick", onTick);
  req.on("close", cleanup);
}
