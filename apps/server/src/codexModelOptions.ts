import type { ModelSelection, ServerProviderModel } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";

export function getCodexDefaultReasoningEffort(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
): string | undefined {
  const descriptor = models
    .find((entry) => entry.slug === model)
    ?.capabilities?.optionDescriptors?.find((option) => option.id === "reasoningEffort");
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : undefined;
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}
