import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readConfig, resolveTarget, splitModelRef } from "../config.ts";
import type { SubagentsConfig } from "../types.ts";

const config: SubagentsConfig = {
  "pi-claude/claude-opus-5": {
    low: { model: "pi-claude/claude-haiku-4-5", effort: "medium" },
    high: { model: "pi-claude/claude-opus-5" },
  },
};

test("resolves a configured level", () => {
  assert.deepEqual(resolveTarget(config, "pi-claude/claude-opus-5", "low"), {
    model: "pi-claude/claude-haiku-4-5",
    effort: "medium",
  });
});

test("rejects a parent model that isn't configured", () => {
  assert.throws(
    () => resolveTarget(config, "openai-codex/gpt-5.6-sol", "low"),
    {
      message: "Not available for this model (openai-codex/gpt-5.6-sol)",
    },
  );
});

test("names the configured levels when the requested one is missing", () => {
  assert.throws(
    () => resolveTarget(config, "pi-claude/claude-opus-5", "medium"),
    {
      message:
        "This agent intelligence level is not available for this model. Available options: [low, high]",
    },
  );
});

test("splits a model ref at the first slash only", () => {
  assert.deepEqual(
    splitModelRef("openrouter/deepseek/deepseek-v4-flash-0731"),
    {
      provider: "openrouter",
      id: "deepseek/deepseek-v4-flash-0731",
    },
  );
});

test("reads the extension's key out of project settings", () => {
  const cwd = writeSettings(`{
    "@destiner/pi-subagents": {
      "pi-claude/claude-opus-5": {
        "low": { "model": "pi-claude/claude-fable-5", "effort": "low" }
      }
    }
  }`);

  assert.deepEqual(readConfig(cwd), {
    "pi-claude/claude-opus-5": {
      low: { model: "pi-claude/claude-fable-5", effort: "low" },
    },
  });
});

test("reads as empty when the key is absent", () => {
  assert.deepEqual(readConfig(writeSettings(`{ "theme": "dark" }`)), {});
});

const malformed: Array<[string, RegExp]> = [
  [`{"@destiner/pi-subagents": []}`, /must be an object/],
  [
    `{"@destiner/pi-subagents": {"claude-opus-5": {}}}`,
    /exact "provider\/model-id" key/,
  ],
  [
    `{"@destiner/pi-subagents": {"a/b": {"tiny": {"model": "a/b"}}}}`,
    /a\/b\.tiny must be one of \[low, medium, high\]/,
  ],
  [
    `{"@destiner/pi-subagents": {"a/b": {"low": "a/b"}}}`,
    /must be an object with a model/,
  ],
  [
    `{"@destiner/pi-subagents": {"a/b": {"low": {"model": "nope"}}}}`,
    /a\/b\.low\.model must be an exact "provider\/model-id" string/,
  ],
  [
    `{"@destiner/pi-subagents": {"a/b": {"low": {"model": "a/b", "effort": "turbo"}}}}`,
    /a\/b\.low\.effort must be one of \[off, minimal, low, medium, high, xhigh, max\]/,
  ],
];

for (const [settings, expected] of malformed) {
  test(`rejects malformed config: ${settings}`, () => {
    assert.throws(() => readConfig(writeSettings(settings)), expected);
  });
}

function writeSettings(settings: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagents-"));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "settings.json"), settings);
  return cwd;
}
