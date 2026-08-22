import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type ExtensionContext,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import type { Effort, Usage } from "./types.ts";

export type ResolvedModel = NonNullable<
  ReturnType<ExtensionContext["modelRegistry"]["find"]>
>;

export interface Progress {
  /** The child's effective level after pi clamps it to the model. */
  effort: Effort;
  text: string;
  toolCalls: number;
  currentTool?: string;
  usage: Usage;
}

export interface RunResult extends Progress {
  /** Set when the subagent's final turn failed rather than completing. */
  failure?: string;
}

export interface RunOptions {
  ctx: ExtensionContext;
  model: ResolvedModel;
  effort: Effort;
  prompt: string;
  /** Session name, for debugging and transcripts. */
  name: string;
  /** Tool the child must not inherit — this extension's own, so no recursion. */
  excludeTool: string;
  signal?: AbortSignal;
  onProgress: (progress: Progress) => void;
}

export async function runSubagent(options: RunOptions): Promise<RunResult> {
  const { ctx, prompt, signal, onProgress } = options;

  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    model: options.model,
    thinkingLevel: options.effort,
    sessionManager: SessionManager.inMemory(ctx.cwd),
    // Inherit the parent's providers and credentials, including any registered
    // by extensions. A fresh runtime would only know auth.json.
    modelRuntime: parentModelRuntime(ctx),
    excludeTools: [options.excludeTool],
  });

  // Extension tools and MCP servers only exist in the child once bound.
  await session.bindExtensions({});
  session.setSessionName(options.name);

  let text = "";
  let toolCalls = 0;
  let currentTool: string | undefined;
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const progress = (): Progress => ({
    effort: session.thinkingLevel,
    text,
    toolCalls,
    currentTool,
    usage,
  });

  // Report the clamped effort before any work happens.
  onProgress(progress());

  const unsubscribe = session.subscribe((event) => {
    switch (event.type) {
      // Reset on a new assistant message so `text` ends up holding the final
      // one — the subagent's answer, not its running commentary.
      case "message_start":
        if (event.message.role === "assistant") text = "";
        break;
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          text += event.assistantMessageEvent.delta;
        }
        break;
      case "tool_execution_start":
        toolCalls += 1;
        currentTool = event.toolName;
        onProgress(progress());
        break;
      case "tool_execution_end":
        currentTool = undefined;
        onProgress(progress());
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          addUsage(usage, event.message.usage);
          onProgress(progress());
        }
        break;
    }
  });

  const stopForwardingAbort = forwardAbort(session, signal);

  try {
    await session.prompt(prompt);
    return {
      ...progress(),
      currentTool: undefined,
      text: text.trim() || lastAssistantText(session),
      failure: finalTurnFailure(session),
    };
  } finally {
    unsubscribe();
    stopForwardingAbort();
    session.dispose();
  }
}

function parentModelRuntime(ctx: ExtensionContext): ModelRuntime | undefined {
  return (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
}

function forwardAbort(
  session: AgentSession,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) return () => {};
  const onAbort = () => void session.abort();
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort);
  return () => signal.removeEventListener("abort", onAbort);
}

/** Fallback for when no text deltas arrived (non-streaming providers). */
function lastAssistantText(session: AgentSession): string {
  for (const message of newestFirst(session)) {
    if (message.role !== "assistant") continue;
    const text = extractText(message.content).trim();
    if (text) return text;
  }
  return "";
}

/**
 * Why the final turn stopped, when it stopped badly. Without this a provider
 * error or a blown output-token ceiling looks like a subagent that simply had
 * nothing to say.
 */
function finalTurnFailure(session: AgentSession): string | undefined {
  for (const message of newestFirst(session)) {
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") {
      return message.errorMessage?.trim() || "provider error with no output";
    }
    if (
      message.stopReason === "length" &&
      !extractText(message.content).trim()
    ) {
      return "hit the output token limit before producing any text";
    }
    return undefined;
  }
  return undefined;
}

function newestFirst(session: AgentSession) {
  return [...session.messages].reverse();
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { text?: string } => isTextBlock(block))
    .map((block) => block.text ?? "")
    .join("\n");
}

function isTextBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: string }).type === "text"
  );
}

function addUsage(total: Usage, next: Usage | undefined): void {
  if (!next) return;
  total.input += next.input ?? 0;
  total.output += next.output ?? 0;
  total.cacheRead += next.cacheRead ?? 0;
  total.cacheWrite += next.cacheWrite ?? 0;
}
