/**
 * Converts a value to a plain JSON-safe object.
 * Date objects become ISO strings, nulls and primitives are preserved.
 * This bridges Drizzle ORM's Date return types with Zod schemas that expect strings.
 */
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
