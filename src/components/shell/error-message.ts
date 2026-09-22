/** Human-readable text for a failed action. ApiError messages are written to be shown as-is (§5.3). */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}
