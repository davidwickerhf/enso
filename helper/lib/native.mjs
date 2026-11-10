// Firefox native messaging framing on stdin/stdout: a 4-byte little-endian
// length followed by UTF-8 JSON. Nothing else may be written to stdout.

import { logLine } from "./logfile.mjs";

const MAX_FRAME = 1024 * 1024; // frames to the browser must stay under 1 MB

export function send(msg) {
  let body = Buffer.from(JSON.stringify(msg));
  if (body.length > MAX_FRAME) {
    body = Buffer.from(JSON.stringify({ type: msg.type, conversationId: msg.conversationId, error: "message too large", truncated: true }));
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

export function onMessage(handler) {
  let inbox = Buffer.alloc(0);
  process.stdin.on("data", chunk => {
    inbox = Buffer.concat([inbox, chunk]);
    while (inbox.length >= 4) {
      const len = inbox.readUInt32LE(0);
      if (inbox.length < 4 + len) break;
      const msg = JSON.parse(inbox.subarray(4, 4 + len).toString("utf8"));
      inbox = inbox.subarray(4 + len);
      handler(msg);
    }
  });
}

// Errors and notes: stderr (the Browser Console) and, in the helper process,
// ~/Library/Logs/Enso/helper.log (lib/logfile.mjs). Log error messages, never
// message contents or page text.
export const log = (...a) => logLine("info", a.join(" "));
export const logError = (...a) => logLine("error", a.join(" "));
