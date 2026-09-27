import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server HTML and until React hydrates, then true. Forms that submit through JavaScript use it
 * to keep their submit button disabled until their handler is attached, so a tap before then (or when the
 * scripts never load) can't fall through to a native form submit (docs/design-decisions.md#d30).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
