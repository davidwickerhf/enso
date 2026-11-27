import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { localEngineModels, runLocalTurn } from "../lib/engine-local.mjs";

const bin = mkdtempSync(path.join(tmpdir(), "enso-local-engine-test-"));
const originalPath = process.env.PATH;
process.env.PATH = bin;
const executable = (name, script) => writeFileSync(path.join(bin, name), `#!${process.execPath}\n${script}`, { mode: 0o700 });

const fakeRpc = `
const assert = require("node:assert/strict");
const { createInterface } = require("node:readline");
const send = frame => process.stdout.write(JSON.stringify(frame) + "\\n");
createInterface({ input: process.stdin }).on("line", line => {
  const { id, method, params, result } = JSON.parse(line);
  const reply = result => send({ id, result });
  const update = (method, params) => send({ method, params });
`;

const fakeCodex = fakeRpc + `
  switch (method) {
    case "initialize": reply({}); break;
    case "account/read": reply({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }); break;
    case "model/list": reply(params.cursor ? { data: [] } : {
      nextCursor: "next", data: [{ model: "account-model", displayName: "Account model", isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: "low" }] }, { model: "hidden", hidden: true }],
    }); break;
    case "config/read": reply({ config: { mcp_servers: { personal: { enabled: true } } } }); break;
    case "thread/start":
      assert.equal(params.model, "account-model");
      assert.equal(params.ephemeral, true);
      assert.equal(params.sandbox, "read-only");
      assert.equal(params.approvalPolicy, "never");
      assert.deepEqual(params.config.mcp_servers, { personal: { enabled: false } });
      reply({ thread: { id: "thread" } });
      break;
    case "turn/start": {
      assert.equal(params.effort, "low");
      const text = params.input.find(item => item.type === "text").text;
      assert.match(text, /Earlier answer/);
      assert.match(text, /Current page/);
      assert.match(params.input.find(item => item.type === "image").url, /^data:image\\/png;base64,/);
      reply({ turn: { id: "turn" } });
      update("item/agentMessage/delta", { threadId: "thread", itemId: "msg", delta: "Co" });
      if (text.includes("WAIT")) break;
      update("item/completed", { threadId: "thread", item: { type: "agentMessage", id: "msg", text: "Codex reply" } });
      update("thread/tokenUsage/updated", { threadId: "thread", tokenUsage: { last: { inputTokens: 4, outputTokens: 3 } } });
      update("turn/completed", { threadId: "thread", turn: { status: "completed" } });
      break;
    }
  }
});
`;

const fakeAntigravity = fakeRpc + `
  const sessionId = "agy-session";
  switch (method) {
    case "initialize": reply({ agentCapabilities: { promptCapabilities: { image: true } } }); break;
    case "session/new":
      assert.deepEqual(params.mcpServers, []);
      reply({
        sessionId, models: { currentModelId: "gemini-low", availableModels: [{ modelId: "gemini-low", name: "Gemini (Low)" }] },
        configOptions: [
          { id: "model", options: [{ value: "gemini" }] },
          { id: "mode", options: [{ value: "plan" }] },
          { id: "thought_level", options: [{ value: "low" }] },
        ],
      });
      break;
    case "session/set_config_option":
      assert.equal(params.value, { model: "gemini", mode: "plan", thought_level: "low" }[params.configId]);
      reply({});
      break;
    case "session/prompt":
      assert.match(params.prompt.find(item => item.type === "text").text, /Earlier answer/);
      assert.equal(params.prompt.find(item => item.type === "image").mimeType, "image/png");
      send({ id: "approval", method: "session/request_permission", params: {} });
      global.turnId = id;
      break;
    default:
      assert.equal(id, "approval");
      assert.deepEqual(result, { outcome: { outcome: "cancelled" } });
      const chunk = text => update("session/update", { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
      chunk("Antigravity ");
      chunk("reply");
      send({ id: global.turnId, result: { stopReason: "end_turn", usage: { inputTokens: 4, outputTokens: 3 } } });
  }
});
`;

function context(settings, { stopOnDelta = false } = {}) {
  const abortController = new AbortController();
  const emitted = [];
  const streamed = [];
  return {
    settings, abortController, emitted, streamed,
    emit: e => emitted.push(e),
    delta(kind, id, text) {
      streamed.push({ kind, id, text });
      if (stopOnDelta) abortController.abort();
    },
  };
}

const turn = {
  prompt: [
    { type: "image", source: { media_type: "image/png", data: "aW1hZ2U=" } },
    { type: "text", text: "Current page" },
  ],
  events: [{ kind: "assistant", text: "Earlier answer" }],
};

try {
  assert.equal((await localEngineModels("codex")).available, false);
  executable("codex", fakeCodex);
  executable("agy", fakeAntigravity);
  const codex = await localEngineModels("codex");
  assert.deepEqual(codex.models, [{ id: "account-model", label: "Account model", default: true, efforts: ["low"] }]);
  const agy = await localEngineModels("antigravity");
  assert.deepEqual(agy.models, [{ id: "gemini-low", label: "Gemini (Low)", default: true }]);

  for (const [settings, expected] of [
    [{ engine: "codex", codexModel: "account-model", codexEffort: "low" }, "Codex reply"],
    [{ engine: "antigravity", antigravityModel: "gemini-low" }, "Antigravity reply"],
  ]) {
    const ctx = context(settings);
    assert.deepEqual(await runLocalTurn(ctx, turn), { inputTokens: 4, outputTokens: 3 });
    assert.ok(ctx.streamed.length >= 1);
    assert.deepEqual(ctx.emitted.map(e => [e.kind, e.text]), [["assistant", expected]]);
    assert.equal(ctx.emitted[0].messageId, ctx.streamed[0].id);
  }

  const stopped = context({ engine: "codex", codexModel: "account-model", codexEffort: "low" }, { stopOnDelta: true });
  await assert.rejects(runLocalTurn(stopped, { ...turn, prompt: [...turn.prompt, { type: "text", text: "WAIT" }] }), { name: "AbortError" });
  assert.equal(stopped.emitted[0].text, "Co");

  executable("agy", fakeRpc + `
  if (method === "initialize") reply({});
  else send({ id, error: { code: -32000, message: "Authentication required" } });
});
`);
  assert.match((await localEngineModels("antigravity")).reason, /Run agy in a terminal/);
  console.log("ok - local model lists, chat and images, denied tool access, Stop and sign-in error");
} finally {
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
}
