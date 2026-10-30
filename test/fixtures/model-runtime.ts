import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface FixtureState {
  contexts: ExtensionContext[];
  requests: SimpleStreamOptions[];
  respond?: (options: SimpleStreamOptions) => Promise<void>;
  failure?: string;
}

const key = Symbol.for("pi-subagents.model-runtime-test");

export function fixtureState(): FixtureState {
  const globals = globalThis as typeof globalThis & {
    [key]?: FixtureState;
  };
  return (globals[key] ??= { contexts: [], requests: [] });
}

export default function fixture(pi: ExtensionAPI): void {
  pi.registerProvider("fixture", {
    api: "openai-completions",
    baseUrl: "https://fixture.invalid",
    models: [
      {
        id: "physical",
        name: "Physical fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
    streamSimple: streamFixture,
  });
  pi.registerVirtualModel({
    provider: "fixture",
    id: "alias",
    name: "Alias fixture",
    route(_request, ctx) {
      const model = ctx.modelRegistry.find("fixture", "physical");
      if (!model) throw new Error("Fixture model is missing");
      return { model, thinkingLevel: "off" };
    },
  });
  pi.on("session_start", (_event, ctx) => {
    fixtureState().contexts.push(ctx);
  });
}

function streamFixture(
  model: Model<Api>,
  _context: unknown,
  options: SimpleStreamOptions = {},
) {
  const stream = createAssistantMessageEventStream();
  const state = fixtureState();
  state.requests.push(options);
  void (async () => {
    let failure = state.failure;
    try {
      await state.respond?.(options);
    } catch (error) {
      failure =
        error instanceof Error ? error.message : "Fixture response failed";
    }
    if (options.signal?.aborted) failure = "Fixture aborted";
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: failure ? [] : [{ type: "text", text: "Fixture answer" }],
      stopReason: options.signal?.aborted
        ? "aborted"
        : failure
          ? "error"
          : "stop",
      ...(failure ? { errorMessage: failure } : {}),
      timestamp: Date.now(),
      usage: {
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      stream.push({
        type: "error",
        reason: message.stopReason,
        error: message,
      });
    } else {
      stream.push({ type: "done", reason: "stop", message });
    }
    stream.end();
  })();
  return stream;
}
