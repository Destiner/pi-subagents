# @destiner/pi-subagents

Subagents for [pi](https://pi.dev), with one dial: **intelligence**.

The agent picks `low`, `medium`, or `high`. Your settings decide which model and
thinking level that means, per parent model. The agent never picks a model name,
and you never re-teach it your model preferences.

## Install

```
pi install npm:@destiner/pi-subagents
```

The extension registers a single tool, `agent`. It won't load alongside another
extension that registers a tool of the same name — remove the other one first.

## Configure

Add one key to `~/.pi/agent/settings.json`, keyed by the model driving the
parent session. Nothing works until you do: an unmapped parent model is an
error, not a fallback.

```jsonc
{
  "defaultModel": "claude-opus-5",

  "@destiner/pi-subagents": {
    "pi-claude/claude-opus-5": {
      "low": { "model": "pi-claude/claude-haiku-4-5", "effort": "medium" },
      "medium": { "model": "pi-claude/claude-sonnet-5", "effort": "medium" },
      "high": { "model": "pi-claude/claude-opus-5", "effort": "medium" },
    },
    "openai-codex/gpt-5.6-sol": {
      "low": { "model": "openai-codex/gpt-5.6-sol", "effort": "low" },
    },
  },
}
```

- Keys and `model` values are exact `provider/model-id`. No fuzzy matching, no
  bare ids, no date-stamp tolerance — a typo is an error, not a surprise model.
  Only the first slash separates the provider, so
  `openrouter/deepseek/deepseek-v4-flash-0731` works.
- `effort` is a pi thinking level (`off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max`) and is optional; omitted, it uses your
  `defaultThinkingLevel`. pi clamps it to what the model supports.
- Levels are independent. Define only `low` if that's all you want — asking for
  anything else then fails and tells the agent what it can have instead.
- A project's `.pi/settings.json` overrides the global config per parent model.
- Config is read on every call, so edits apply without restarting pi.

## Use

```
agent({
  description: "audit auth flow",
  intelligence: "medium",
  prompt: "…everything the subagent needs to know…"
})
```

The subagent starts from an empty context: it sees the prompt and nothing else,
returns one text response, and cannot ask questions. Several calls in one turn
run concurrently.

Each subagent owns a separate model runtime. It loads provider configuration,
credentials, extensions, and model aliases through pi's normal discovery rather
than sharing the parent's mutable registrations. Finishing or aborting one
subagent cannot invalidate the parent's or a sibling's model routers.

## Errors

All three arrive as tool errors, so the agent sees them and can adjust:

| Situation                      | Message                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Parent model not in the config | `Not available for this model (pi-claude/claude-opus-5)`                                        |
| Level not configured for it    | `This agent intelligence level is not available for this model. Available options: [low, high]` |
| Configured model has no auth   | `Configured subagent model "…" for intelligence "low" is not available.`                        |

## For RPC clients

`details` is the interface, streamed as `tool_execution_update.partialResult`
and repeated on the final result:

```ts
{
  description: string;
  intelligence: "low" | "medium" | "high";
  model: string;            // resolved "provider/model-id"
  effort: ThinkingLevel;    // after pi's clamping
  status: "running" | "done" | "error";
  elapsedMs: number;
  toolCalls: number;
  currentTool?: string;
  text: string;             // the subagent's text so far
  usage: { input, output, cacheRead, cacheWrite };
}
```

Updates fire when the subagent starts, on each of its tool calls, and at the end
of each of its messages — so text arrives in message-sized chunks rather than
token by token.

## What it deliberately doesn't do

No agent types or roles, no agent files, no background runs, no steering, no
turn limits, no worktree isolation, no context inheritance. Subagents get the
same tools as the parent minus `agent` itself, which is also the whole of the
recursion guard. If the parent aborts, its subagents abort.

Two consequences worth knowing. The subagent inherits every extension and MCP
tool configured in your settings, so a large MCP surface makes even a `low` call
expensive in input tokens. And it loads extensions from settings only —
extensions passed on the command line with `-e` don't reach it. Providers,
aliases, and credentials registered only in the parent's memory aren't inherited
either; configure them through pi's normal settings, extensions, or login so each
subagent can load them independently.
