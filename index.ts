import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defaultEffort,
  readConfig,
  resolveTarget,
  splitModelRef,
} from "./config.ts";
import { runSubagent } from "./runner.ts";
import { renderCall, renderResult } from "./status.ts";
import {
  INTELLIGENCE_LEVELS,
  type AgentDetails,
  type Intelligence,
} from "./types.ts";

const TOOL_NAME = "agent";

const DESCRIPTION = `Delegate a self-contained task to a subagent with its own context window.

The subagent starts fresh: it sees only your prompt, not this conversation. Give it everything it needs — goal, relevant paths, constraints, and what to report back. It returns one text response and cannot ask you questions.

Pick intelligence for the difficulty of the work, not its topic:
- low: mechanical and well-specified. Locating files, running checks, collecting facts.
- medium: normal engineering. Reading unfamiliar code, focused implementation, review.
- high: hard reasoning. Ambiguous debugging, architecture, real tradeoffs.

Issue several calls in one turn for independent tasks. Don't delegate work that only makes sense with your conversation context.`;

export default function subagentsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Agent",
    description: DESCRIPTION,
    promptSnippet:
      "Delegate a self-contained task to a subagent at low, medium, or high intelligence.",
    // Independent delegations in one batch should overlap, not queue.
    executionMode: "parallel",
    parameters: Type.Object({
      description: Type.String({
        description: "3-5 word summary of the task, shown in the UI.",
      }),
      // Plain string enum rather than a literal union: some providers reject
      // the anyOf/const JSON Schema that unions produce.
      intelligence: Type.Unsafe<Intelligence>({
        type: "string",
        enum: [...INTELLIGENCE_LEVELS],
        description:
          "How hard the work is: low (mechanical), medium (normal engineering), high (hard reasoning).",
      }),
      prompt: Type.String({
        description:
          "The subagent's only instruction. Must be self-contained: it cannot see this conversation and cannot ask questions.",
      }),
    }),
    renderCall: (args, theme) => renderCall(args, theme),
    // registerTool doesn't infer TDetails from execute, so it arrives untyped.
    renderResult: (result, options, theme) =>
      renderResult(result.details as AgentDetails | undefined, options, theme),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!ctx.model) {
        throw new Error("No active model to resolve a subagent from.");
      }
      const parentModel = `${ctx.model.provider}/${ctx.model.id}`;

      const target = resolveTarget(
        readConfig(ctx.cwd),
        parentModel,
        params.intelligence,
      );
      const effort = target.effort ?? defaultEffort(ctx.cwd);

      const { provider, id } = splitModelRef(target.model);
      const model = ctx.modelRegistry.find(provider, id);
      if (!model) {
        throw new Error(
          `Configured subagent model "${target.model}" for intelligence "${params.intelligence}" is not available. ` +
            "Check the model id and that you're logged in to its provider.",
        );
      }

      const startedAt = Date.now();
      const details: AgentDetails = {
        description: params.description,
        intelligence: params.intelligence,
        model: target.model,
        effort,
        status: "running",
        elapsedMs: 0,
        toolCalls: 0,
        text: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };

      const result = await runSubagent({
        ctx,
        model,
        effort,
        prompt: params.prompt,
        name: params.description,
        excludeTool: TOOL_NAME,
        signal,
        onProgress: (progress) => {
          Object.assign(details, progress, {
            elapsedMs: Date.now() - startedAt,
          });
          onUpdate?.({
            content: [{ type: "text", text: details.text }],
            details,
          });
        },
      });

      Object.assign(details, result, {
        elapsedMs: Date.now() - startedAt,
        status: result.failure && !result.text ? "error" : "done",
      });

      if (result.failure && !result.text) {
        throw new Error(`Subagent failed: ${result.failure}`);
      }

      const text = result.failure
        ? `${result.text}\n\n[subagent stopped early: ${result.failure}]`
        : result.text || "The subagent finished without producing any output.";

      return { content: [{ type: "text", text }], details };
    },
  });
}
