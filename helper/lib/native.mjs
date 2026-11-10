// Firefox native messaging framing on stdin/stdout: a 4-byte little-endian
// length followed by UTF-8 JSON. Nothing else may be written to stdout.

import { logLine } from "./logfile.mjs";

// Native messaging caps a message to the browser at 1 MB. Anything bigger is
// sent as { type: "chunk", id, seq, total, data } frames: the base64 of the
// message's UTF-8 JSON in slices, which extension/transfer.js puts back
// together before the message is handled. Up to MAX_MESSAGE_BYTES in all.
export const MAX_FRAME = 1024 * 1024;
export const CHUNK_THRESHOLD = 900_000; // messages above this are chunked
export const CHUNK_CHARS = 700_000; // base64 characters per chunk frame (well under MAX_FRAME with the envelope)
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export class MessageTooLargeError extends Error {
  constructor(bytes) {
    super(`This request is too large to send to the browser (${(bytes / 1048576).toFixed(1)} MB; the limit is ${MAX_MESSAGE_BYTES / 1048576} MB). Nothing was sent.`);
    this.name = "MessageTooLargeError";
    this.bytes = bytes;
  }
}

let chunkSeq = 0;

/** The frame bodies (Buffers, each under MAX_FRAME) that carry `msg`. Throws MessageTooLargeError. */
export function encodeFrames(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  if (body.length <= CHUNK_THRESHOLD) return [body];
  if (body.length > MAX_MESSAGE_BYTES) throw new MessageTooLargeError(body.length);
  const b64 = body.toString("base64");
  const id = `c${process.pid}-${++chunkSeq}`;
  const total = Math.ceil(b64.length / CHUNK_CHARS);
  const frames = [];
  for (let seq = 0; seq < total; seq++) frames.push(Buffer.from(JSON.stringify({ type: "chunk", id, seq, total, data: b64.slice(seq * CHUNK_CHARS, (seq + 1) * CHUNK_CHARS) })));
  return frames;
}

const frame = body => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

/**
 * Send a message to the extension. A request (with a reqId) that is too large
 * throws MessageTooLargeError so the caller gets a clear error; any other
 * message too large is replaced by a short error notice, as before.
 */
export function send(msg) {
  let frames;
  try {
    frames = encodeFrames(msg);
  } catch (err) {
    if (msg?.reqId) throw err;
    frames = [Buffer.from(JSON.stringify({ type: msg.type, conversationId: msg.conversationId, error: "message too large", truncated: true }))];
  }
  for (const body of frames) process.stdout.write(frame(body));
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
