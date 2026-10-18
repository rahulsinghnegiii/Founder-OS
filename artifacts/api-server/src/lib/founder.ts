import { companyBrain } from "../services/company-brain";
import { logger } from "./logger";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; name: string | null } | null = null;

/**
 * The founder's display name, used in prompts and email sign-offs.
 * Resolution order: structured founder profile (`name` / `founderName` /
 * `firstName`), then the FOUNDER_NAME env var, then null (prompts fall back
 * to "the founder").
 */
export async function getFounderName(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.name;

  let name: string | null = null;
  try {
    const profile = await companyBrain.getStructuredProfile();
    for (const key of ["name", "founderName", "firstName"]) {
      const value = profile[key];
      if (typeof value === "string" && value.trim()) {
        name = value.trim();
        break;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Could not read founder profile for name");
  }

  if (!name && process.env.FOUNDER_NAME?.trim()) name = process.env.FOUNDER_NAME.trim();

  cache = { at: Date.now(), name };
  return name;
}

export function invalidateFounderNameCache(): void {
  cache = null;
}

/** "Priya's" or "the founder's". */
export function founderPossessive(name: string | null): string {
  return name ? `${name}'s` : "the founder's";
}
