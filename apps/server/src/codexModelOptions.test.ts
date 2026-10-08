import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelCapabilities, createModelSelection } from "@t3tools/shared/model";

import {
  getCodexDefaultReasoningEffort,
  getCodexServiceTierOptionValue,
} from "./codexModelOptions.ts";

it("resolves the reasoning default displayed by the provider catalogue", () => {
  const models = [
    {
      slug: "gpt-6.1-sol",
      name: "Sol",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "low", label: "Low", isDefault: true },
              { id: "medium", label: "Medium" },
            ],
          },
        ],
      }),
    },
  ];
  assert.equal(getCodexDefaultReasoningEffort(models, "gpt-6.1-sol"), "low");
  assert.isUndefined(getCodexDefaultReasoningEffort(models, "unknown-custom-model"));
});

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});
