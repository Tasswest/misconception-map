export const APP_NAME = "Misconception Map";
export const OPENAI_MODEL = "gpt-5.6";

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
