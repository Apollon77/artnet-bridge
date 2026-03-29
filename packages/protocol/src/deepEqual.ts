/**
 * Deep equality check for plain objects and primitives.
 * Adapted from matter.js (Apache-2.0).
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  const aIsObject = typeof a === "object" && a !== null;
  const bIsObject = typeof b === "object" && b !== null;

  if (!aIsObject || !bIsObject) return false;

  const aProps = Object.getOwnPropertyNames(a);
  const bProps = Object.getOwnPropertyNames(b);

  if (aProps.length !== bProps.length) return false;

  for (const propName of aProps) {
    const aProp = (a as Record<string, unknown>)[propName];
    const bProp = (b as Record<string, unknown>)[propName];

    if (!isDeepEqual(aProp, bProp)) return false;
  }

  return true;
}
