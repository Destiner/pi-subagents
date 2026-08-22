import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

import {
  EFFORTS,
  INTELLIGENCE_LEVELS,
  type Effort,
  type Intelligence,
  type LevelMap,
  type SubagentsConfig,
  type Target,
} from "./types.ts";

export const SETTINGS_KEY = "@destiner/pi-subagents";

/**
 * Read the extension's key from pi's settings, project overriding global per
 * parent-model key. Unknown keys survive pi's own settings writes, so this
 * lives alongside `defaultModel` instead of in a file of its own.
 *
 * Read on every call so edits apply without restarting pi.
 */
export function readConfig(cwd: string): SubagentsConfig {
  const settings = SettingsManager.create(cwd, getAgentDir());
  return {
    ...parseConfig(settings.getGlobalSettings(), "global"),
    ...parseConfig(settings.getProjectSettings(), "project"),
  };
}

/** pi's configured default thinking level, used when a target omits `effort`. */
export function defaultEffort(cwd: string): Effort {
  const settings = SettingsManager.create(cwd, getAgentDir());
  return settings.getDefaultThinkingLevel() ?? "medium";
}

export function resolveTarget(
  config: SubagentsConfig,
  parentModel: string,
  intelligence: Intelligence,
): Target {
  const levels = config[parentModel];
  if (!levels) {
    throw new Error(`Not available for this model (${parentModel})`);
  }

  const target = levels[intelligence];
  if (!target) {
    const available = INTELLIGENCE_LEVELS.filter((level) => levels[level]);
    throw new Error(
      "This agent intelligence level is not available for this model. " +
        `Available options: [${available.join(", ")}]`,
    );
  }

  return target;
}

/** Split at the first slash only: model ids may contain slashes. */
export function splitModelRef(ref: string): { provider: string; id: string } {
  const slash = ref.indexOf("/");
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

function parseConfig(settings: unknown, scope: string): SubagentsConfig {
  const raw = (settings as Record<string, unknown> | undefined)?.[SETTINGS_KEY];
  if (raw === undefined) return {};

  const invalid = (path: string, expected: string): Error =>
    new Error(
      `Invalid "${SETTINGS_KEY}" ${scope} settings: ${path} ${expected}`,
    );

  if (!isRecord(raw)) throw invalid(SETTINGS_KEY, "must be an object");

  const config: SubagentsConfig = {};
  for (const [parentModel, levels] of Object.entries(raw)) {
    if (!isModelRef(parentModel)) {
      throw invalid(parentModel, 'must be an exact "provider/model-id" key');
    }
    if (!isRecord(levels)) throw invalid(parentModel, "must be an object");

    const parsed: LevelMap = {};
    for (const [level, target] of Object.entries(levels)) {
      const path = `${parentModel}.${level}`;
      if (!isIntelligence(level)) {
        throw invalid(
          path,
          `must be one of [${INTELLIGENCE_LEVELS.join(", ")}]`,
        );
      }
      if (!isRecord(target)) {
        throw invalid(
          path,
          "must be an object with a model and an optional effort",
        );
      }
      if (typeof target.model !== "string" || !isModelRef(target.model)) {
        throw invalid(
          `${path}.model`,
          'must be an exact "provider/model-id" string',
        );
      }
      if (target.effort !== undefined && !isEffort(target.effort)) {
        throw invalid(
          `${path}.effort`,
          `must be one of [${EFFORTS.join(", ")}]`,
        );
      }
      parsed[level] = { model: target.model, effort: target.effort };
    }
    config[parentModel] = parsed;
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelRef(value: string): boolean {
  const slash = value.indexOf("/");
  return slash > 0 && slash < value.length - 1;
}

function isIntelligence(value: string): value is Intelligence {
  return (INTELLIGENCE_LEVELS as readonly string[]).includes(value);
}

function isEffort(value: unknown): value is Effort {
  return (EFFORTS as readonly string[]).includes(value as string);
}
