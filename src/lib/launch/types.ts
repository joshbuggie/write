import type { IntegrationKind } from "@/lib/integrations";

/**
 * "Send to…" as the note screen sees it (docs/design-decisions.md#d31). Isomorphic.
 */

/** A harness this note can be sent to. */
export interface SendTarget {
  integrationId: string;
  name: string;
  kind: IntegrationKind;
  /** Whether an earlier job exists for this note, so "Send to…" can continue that conversation. */
  hasConversation: boolean;
}

/** A job sent from this note whose changes haven't arrived yet. */
export interface WorkingJob {
  jobId: string;
  source: string;
  /** A Turnstone coordinator, which stops at write's tools until they are approved in Turnstone. */
  mayNeedApproval: boolean;
  /** ISO 8601. */
  createdAt: string;
}

export interface NoteSendState {
  targets: SendTarget[];
  /**
   * Harnesses with a launcher that can't read this note's folder, by name. The Send button shows greyed out
   * for them instead of vanishing, so it's clear the folder is what's missing.
   */
  blocked: string[];
  working: WorkingJob[];
}
