import { Text } from "@earendil-works/pi-tui";

import { splitModelRef } from "./config.ts";
import type { AgentDetails, Intelligence } from "./types.ts";

const COLLAPSED_LINES = 6;

/** Structural subset of pi's interactive Theme, which isn't exported publicly. */
interface Theme {
  fg(color: "muted" | "error", text: string): string;
  bold(text: string): string;
}

export function renderCall(
  args: { description?: string; intelligence?: Intelligence },
  theme: Theme,
): Text {
  const description = args.description?.trim() || "subagent";
  const parts = [theme.bold(description)];
  if (args.intelligence) parts.push(theme.fg("muted", args.intelligence));
  return new Text(parts.join(" "), 1, 0);
}

export function renderResult(
  details: AgentDetails | undefined,
  options: { expanded: boolean },
  theme: Theme,
): Text {
  if (!details) return new Text("", 1, 0);

  const status = statusLine(details, theme);
  if (details.status === "running") return new Text(status, 1, 0);

  const text = details.text.trim();
  const body = options.expanded ? text : collapse(text, theme);
  return new Text(body ? `${status}\n${body}` : status, 1, 0);
}

function statusLine(details: AgentDetails, theme: Theme): string {
  const parts = [
    splitModelRef(details.model).id,
    details.effort,
    `${Math.round(details.elapsedMs / 1000)}s`,
  ];
  if (details.toolCalls > 0) parts.push(`${details.toolCalls} tools`);
  if (details.currentTool) parts.push(details.currentTool);
  const line = theme.fg("muted", parts.join(" · "));
  return details.status === "error"
    ? `${line} ${theme.fg("error", "failed")}`
    : line;
}

function collapse(text: string, theme: Theme): string {
  const lines = text.split("\n");
  if (lines.length <= COLLAPSED_LINES) return text;
  const hidden = lines.length - COLLAPSED_LINES;
  return [
    ...lines.slice(0, COLLAPSED_LINES),
    theme.fg("muted", `… +${hidden} lines`),
  ].join("\n");
}
