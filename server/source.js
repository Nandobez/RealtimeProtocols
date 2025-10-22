/**
 * Shared "ticker" data source.
 *
 * We pretend to be a tiny stock feed. Every TICK_MS we publish a price update
 * for a basket of symbols. Each protocol handler subscribes to this same
 * source so the four panels in the UI render exactly the same data — only the
 * transport differs.
 */
import { EventEmitter } from "node:events";

const TICK_MS = 250;
const SYMBOLS = ["DUCK", "GPT", "BTC", "USD", "TSLA", "MSFT", "GOOG"];

class Ticker extends EventEmitter {
  constructor() {
    super();
    this.prices = Object.fromEntries(SYMBOLS.map((s) => [s, 100 + Math.random() * 50]));
    this.seq = 0;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const delta = (Math.random() - 0.5) * 2;
      this.prices[symbol] = Math.max(0.01, this.prices[symbol] + delta);
      const tick = {
        seq: ++this.seq,
        ts: Date.now(),
        symbol,
        price: +this.prices[symbol].toFixed(4),
        delta: +delta.toFixed(4),
      };
      this.emit("tick", tick);
    }, TICK_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

export const ticker = new Ticker();
ticker.start();
