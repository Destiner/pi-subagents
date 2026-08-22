export const INTELLIGENCE_LEVELS = ["low", "medium", "high"] as const;

export type Intelligence = (typeof INTELLIGENCE_LEVELS)[number];

/** pi thinking levels, mirrored so config validation has a domain of its own. */
export const EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type Effort = (typeof EFFORTS)[number];

/** A resolved (model, effort) pair for one intelligence level. */
export interface Target {
  /** Exact "provider/model-id". */
  model: string;
  effort?: Effort;
}

export type LevelMap = Partial<Record<Intelligence, Target>>;

/** Keyed by the parent's exact "provider/model-id". */
export type SubagentsConfig = Record<string, LevelMap>;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Streamed to consumers as `tool_execution_update.partialResult.details`, then
 * once more as the final tool result. This is the primary interface for RPC
 * clients; the TUI renderers read the same shape.
 */
export interface AgentDetails {
  description: string;
  intelligence: Intelligence;
  /** Resolved "provider/model-id" the subagent is running on. */
  model: string;
  effort: Effort;
  status: "running" | "done" | "error";
  elapsedMs: number;
  toolCalls: number;
  currentTool?: string;
  /** The subagent's assistant text so far. */
  text: string;
  usage: Usage;
}
