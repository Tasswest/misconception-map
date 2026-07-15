import { z } from "zod";

export const problemRegionAIOutputSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();

export const normalizedProblemRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((region) => region.x + region.width <= 1, {
    message: "The problem region must fit within the page width.",
  })
  .refine((region) => region.y + region.height <= 1, {
    message: "The problem region must fit within the page height.",
  });

const MINIMUM_REGION_SPAN = 0.005;

/**
 * Bounding regions are presentation metadata, never diagnostic evidence.
 * Invalid or degenerate regions are discarded without affecting the nested
 * diagnosis.
 *
 * @param {unknown} value
 */
export function normalizeProblemRegion(value) {
  const parsed = problemRegionAIOutputSchema.safeParse(value);
  if (!parsed.success) return null;

  const region = parsed.data;
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.width < MINIMUM_REGION_SPAN ||
    region.height < MINIMUM_REGION_SPAN ||
    region.x + region.width > 1 ||
    region.y + region.height > 1
  ) {
    return null;
  }

  return normalizedProblemRegionSchema.parse(region);
}
