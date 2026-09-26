"use client";

import { useEffect, useRef, useState } from "react";
import type { IntegrationRequest, IntegrationTokenResponse } from "@/lib/api-contract";
import { api } from "@/lib/api-client";
import type { IntegrationView } from "@/lib/integrations";

/** What the Integrations dialog can do; each action throws an ApiError whose message can be shown. */
export type IntegrationsApi = {
  /** Null while loading. */
  items: IntegrationView[] | null;
  loadError: string | null;
  create: (input: IntegrationRequest) => Promise<IntegrationTokenResponse>;
  update: (id: string, input: IntegrationRequest) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rotate: (id: string) => Promise<IntegrationTokenResponse>;
};

/**
 * The integrations, loaded when the dialog opens rather than with every page, and kept in step with each
 * change the dialog makes. Changes are saved at once, like the password: there is no draft to lose. The
 * list loads again when the window regains focus, so "Last used" updates after pasting a token into a
 * harness in another window.
 */
export function useIntegrations(): IntegrationsApi {
  const [items, setItems] = useState<IntegrationView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by every change the dialog makes, so a reload that started before it can't bring back the old list.
  const changes = useRef(0);

  useEffect(() => {
    let live = true;
    const load = () => {
      const startedAt = changes.current;
      return api.listIntegrations().then(
        (res) => {
          if (!live || changes.current !== startedAt) return;
          setItems(res.integrations);
          setLoadError(null);
        },
        (err: unknown) =>
          live && setLoadError(err instanceof Error && err.message ? err.message : "Couldn't load them."),
      );
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, []);

  const replace = (next: IntegrationView) => {
    changes.current++;
    setItems((current) => (current ?? []).map((i) => (i.id === next.id ? next : i)));
  };

  return {
    items,
    loadError,
    async create(input) {
      const made = await api.createIntegration(input);
      changes.current++;
      setItems((current) => [...(current ?? []), made.integration]);
      return made;
    },
    async update(id, input) {
      replace((await api.updateIntegration({ id, ...input })).integration);
    },
    async remove(id) {
      await api.deleteIntegration(id);
      changes.current++;
      setItems((current) => (current ?? []).filter((i) => i.id !== id));
    },
    async rotate(id) {
      const rotated = await api.rotateIntegrationToken(id);
      replace(rotated.integration);
      return rotated;
    },
  };
}
