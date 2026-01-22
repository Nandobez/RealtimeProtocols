import { startSSE, stopSSE, ssePanel } from "./sse.js";
import { startLongPoll, stopLongPoll, longpollPanel } from "./longpoll.js";
import { startWS, stopWS, wsPanel } from "./ws.js";
import { startWebTransport, stopWebTransport, wtPanel } from "./webtransport.js";

const startAll = () => {
  startSSE();
  startLongPoll();
  startWS();
  startWebTransport();
};
const stopAll = () => {
  stopSSE();
  stopLongPoll();
  stopWS();
  stopWebTransport();
};
const reset = () => {
  ssePanel.reset();
  longpollPanel.reset();
  wsPanel.reset();
  wtPanel.reset();
};

document.getElementById("start-all").addEventListener("click", startAll);
document.getElementById("stop-all").addEventListener("click", stopAll);
document.getElementById("reset").addEventListener("click", reset);

// auto-start on first load so visitors see something happen
startAll();
