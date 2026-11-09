// A small Marionette client (Firefox/Zen's WebDriver protocol over TCP), used
// to drive the headless Zen. Wire format: "<length>:<json>". Commands are
// [0, id, name, params]; replies are [1, id, error, result].

import net from "node:net";

export const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export class Marionette {
  constructor() {
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.seq = 0;
    this.pending = new Map();
    this.hello = null;
    this.closed = false;
  }

  connect(port, host = "127.0.0.1", timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ port, host });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("Marionette did not answer."));
      }, timeoutMs);
      this.hello = { resolve: msg => (clearTimeout(timer), resolve(msg)), reject };
      sock.on("data", chunk => this.onData(chunk));
      sock.on("error", err => {
        clearTimeout(timer);
        this.fail(err);
        reject(err);
      });
      sock.on("close", () => this.fail(new Error("The headless browser closed the connection.")));
      this.sock = sock;
    });
  }

  fail(err) {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const colon = this.buf.indexOf(0x3a); // ":"
      if (colon < 0) return;
      const len = Number(this.buf.subarray(0, colon).toString("ascii"));
      if (!Number.isFinite(len) || this.buf.length < colon + 1 + len) return;
      const body = this.buf.subarray(colon + 1, colon + 1 + len).toString("utf8");
      this.buf = this.buf.subarray(colon + 1 + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (this.hello && !Array.isArray(msg)) {
        const h = this.hello;
        this.hello = null;
        h.resolve(msg);
        continue;
      }
      if (Array.isArray(msg) && msg[0] === 1) {
        const p = this.pending.get(msg[1]);
        if (!p) continue;
        this.pending.delete(msg[1]);
        clearTimeout(p.timer);
        if (msg[2]) p.reject(Object.assign(new Error(`${msg[2].error}: ${msg[2].message}`), { webdriver: msg[2] }));
        else p.resolve(msg[3]);
      }
    }
  }

  send(name, params = {}, timeoutMs = 60_000) {
    if (this.closed || !this.sock) return Promise.reject(new Error("The headless browser is not connected."));
    const id = ++this.seq;
    const json = Buffer.from(JSON.stringify([0, id, name, params]), "utf8");
    this.sock.write(Buffer.concat([Buffer.from(`${json.length}:`, "ascii"), json]));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${name} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Commands answer { value: … }; unwrap it. */
  async call(name, params, timeoutMs) {
    const r = await this.send(name, params, timeoutMs);
    return r && typeof r === "object" && "value" in r ? r.value : r;
  }

  close() {
    this.closed = true;
    try {
      this.sock?.destroy();
    } catch {}
  }
}
