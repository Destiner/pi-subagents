import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { runSubagent, type RunOptions } from "../runner.ts";
import { fixtureState, type FixtureState } from "./fixtures/model-runtime.ts";

let cwd: string;
let state: FixtureState;
let parent: AgentSession;
let ctx: ExtensionContext;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "pi-subagents-runtime-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = cwd;
  state = fixtureState();
  state.contexts = [];
  state.requests = [];
  delete state.respond;
  delete state.failure;

  writeFileSync(
    join(cwd, "settings.json"),
    JSON.stringify({
      extensions: [
        fileURLToPath(new URL("./fixtures/model-runtime.ts", import.meta.url)),
      ],
      defaultProvider: "fixture",
      defaultModel: "alias",
      retry: { enabled: false },
      compaction: { keepRecentTokens: 1 },
    }),
  );
  writeFileSync(
    join(cwd, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "synthetic-fixture-key" },
    }),
  );
  ({ session: parent } = await createAgentSession({
    cwd,
    agentDir: cwd,
    sessionManager: SessionManager.inMemory(cwd),
  }));
  await parent.bindExtensions({});
  assert.equal(state.contexts.length, 1);
  ctx = state.contexts[0]!;
  const alias = parent.modelRuntime.getModel("fixture", "alias");
  assert.ok(alias);
  await parent.setModel(alias);
});

afterEach(() => {
  parent?.dispose();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(cwd, { recursive: true, force: true });
});

test("child aliases and provider auth are isolated from the parent", async () => {
  await parent.prompt("Before delegation");
  const result = await runSubagent(options());
  assert.equal(result.failure, undefined);
  assert.equal(result.text, "Fixture answer");
  assert.equal(result.usage.input, 100);
  assert.equal(state.contexts.length, 2);
  assert.throws(() => state.contexts[1]!.modelRegistry, /stale/);
  assertParentRoute();
  await assertRoute(parent.modelRuntime);
  assert.ok(
    state.requests.every(
      (request) => request.apiKey === "synthetic-fixture-key",
    ),
  );

  await parent.prompt("After delegation");
  assert.equal(parent.messages.at(-1)?.role, "assistant");
  assert.equal(parent.getLastAssistantText(), "Fixture answer");
  const resultAfterCompaction = await parent.compact();
  assert.match(resultAfterCompaction.summary, /Fixture answer/);
  assertParentRoute();
});

test("finishing one child does not break an overlapping sibling or the parent", async () => {
  const firstStarted = gate();
  const secondStarted = gate();
  const finishFirst = gate();
  const finishSecond = gate();
  let requests = 0;
  state.respond = async () => {
    if (++requests === 1) {
      firstStarted.resolve();
      await finishFirst.promise;
    } else {
      secondStarted.resolve();
      await finishSecond.promise;
    }
  };

  const first = runSubagent(options());
  await firstStarted.promise;
  const second = runSubagent(options());
  await secondStarted.promise;
  const firstCtx = state.contexts[1]!;
  const secondCtx = state.contexts[2]!;
  assert.notEqual(runtime(firstCtx), runtime(ctx));
  assert.notEqual(runtime(secondCtx), runtime(ctx));
  assert.notEqual(runtime(firstCtx), runtime(secondCtx));

  finishFirst.resolve();
  assert.equal((await first).failure, undefined);
  assert.throws(() => firstCtx.modelRegistry, /stale/);
  assert.ok(secondCtx.modelRegistry.find("fixture", "alias"));
  await assertRoute(runtime(secondCtx));
  await assertRoute(parent.modelRuntime);
  finishSecond.resolve();
  assert.equal((await second).failure, undefined);
  await assertRoute(parent.modelRuntime);
});

test("a failed child leaves parent routing intact", async () => {
  state.failure = "Synthetic provider failure";
  const result = await runSubagent(options());
  assert.match(result.failure ?? "", /Synthetic provider failure/);
  delete state.failure;
  await assertRoute(parent.modelRuntime);
  assert.throws(() => state.contexts[1]!.modelRegistry, /stale/);
});

test("an aborted child leaves parent routing intact", async () => {
  const started = gate();
  const controller = new AbortController();
  state.respond = async ({ signal }) => {
    started.resolve();
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  };
  const pending = runSubagent({ ...options(), signal: controller.signal });
  await started.promise;
  controller.abort();
  await pending;
  assert.throws(() => state.contexts[1]!.modelRegistry, /stale/);
  await assertRoute(parent.modelRuntime);
});

test("setup callback failures also dispose the child", async () => {
  await assert.rejects(
    runSubagent({
      ...options(),
      onProgress: () => {
        throw new Error("Synthetic progress failure");
      },
    }),
    /Synthetic progress failure/,
  );
  assert.throws(() => state.contexts[1]!.modelRegistry, /stale/);
  await assertRoute(parent.modelRuntime);
});

function options(): RunOptions {
  assert.ok(parent.model);
  return {
    ctx,
    model: parent.model,
    effort: "off",
    prompt: "Synthetic subagent task",
    name: "Runtime isolation test",
    excludeTool: "agent",
    onProgress: () => {},
  };
}

function runtime(context: ExtensionContext) {
  return (
    context.modelRegistry as unknown as {
      runtime: AgentSession["modelRuntime"];
    }
  ).runtime;
}

async function assertRoute(modelRuntime: AgentSession["modelRuntime"]) {
  const alias = modelRuntime.getModel("fixture", "alias");
  assert.ok(alias);
  const result = await modelRuntime.resolveModel(alias, [], {
    reason: "direct",
    thinkingLevel: "off",
  });
  assert.equal(result.model.id, "physical");
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertParentRoute() {
  assert.ok(ctx.modelRegistry.find("fixture", "physical"));
  assert.equal(parent.model?.id, "alias");
}
