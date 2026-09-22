/**
 * Human-readable text for a failed action. ApiError messages are written to be shown as-is (see
 * docs/design-decisions.md#d3).
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}
