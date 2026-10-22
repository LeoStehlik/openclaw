import { resolveOptionalIntegerOption } from "@openclaw/normalization-core/number-coercion";

export type PollInput = {
  question: string;
  options: string[];
  maxSelections?: number;
  /**
   * Poll duration in seconds.
   * Channel-specific limits apply in each owning plugin.
   */
  durationSeconds?: number;
  /**
   * Poll duration in hours.
   * Used by channels that model duration in hours.
   */
  durationHours?: number;
};

export type NormalizedPollInput = {
  question: string;
  options: string[];
  maxSelections: number;
  durationSeconds?: number;
  durationHours?: number;
};

type NormalizePollOptions = {
  maxOptions?: number;
};

export function resolvePollMaxSelections(
  optionCount: number,
  allowMultiselect: boolean | undefined,
): number {
  return allowMultiselect ? Math.max(2, optionCount) : 1;
}

export function normalizePollInput(
  input: PollInput,
  options: NormalizePollOptions = {},
): NormalizedPollInput {
  const question = input.question.trim();
  if (!question) {
    throw new Error("Poll question is required");
  }
  const pollOptions = (input.options ?? []).map((option) => option.trim());
  const cleaned = pollOptions.filter(Boolean);
  if (cleaned.length < 2) {
    throw new Error("Poll requires at least 2 options");
  }
  if (options.maxOptions !== undefined && cleaned.length > options.maxOptions) {
    throw new Error(`Poll supports at most ${options.maxOptions} options`);
  }
  const maxSelections = resolveOptionalIntegerOption(input.maxSelections) ?? 1;
  if (maxSelections < 1) {
    throw new Error("maxSelections must be at least 1");
  }
  if (maxSelections > cleaned.length) {
    throw new Error("maxSelections cannot exceed option count");
  }

  const durationSeconds = resolveOptionalIntegerOption(input.durationSeconds);
  if (durationSeconds !== undefined && durationSeconds < 1) {
    throw new Error("durationSeconds must be at least 1");
  }

  const durationHours = resolveOptionalIntegerOption(input.durationHours);
  if (durationHours !== undefined && durationHours < 1) {
    throw new Error("durationHours must be at least 1");
  }
  if (durationSeconds !== undefined && durationHours !== undefined) {
    throw new Error("durationSeconds and durationHours are mutually exclusive");
  }
  return {
    question,
    options: cleaned,
    maxSelections,
    durationSeconds,
    durationHours,
  };
}

export function normalizePollDurationHours(
  value: number | undefined,
  options: { defaultHours: number; maxHours: number },
): number {
  const base = resolveOptionalIntegerOption(value) ?? options.defaultHours;
  return Math.min(Math.max(base, 1), options.maxHours);
}
