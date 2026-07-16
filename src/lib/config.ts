import "server-only";

import { getAiAvailability } from "@/server/openai/spend-protection";

export const APP_NAME = "Misconception Map";
export const OPENAI_MODEL = "gpt-5.6";

export function isOpenAIConfigured() {
  return getAiAvailability().available;
}
